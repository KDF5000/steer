#include "SteerLocalASR.h"
#include "whisper.h"
#include <atomic>
#include <algorithm>
#include <chrono>
#include <cstring>
#include <string>
#include <sys/resource.h>

using Clock = std::chrono::steady_clock;
struct SteerASRCancellation { std::atomic<bool> cancelled{false}; };
struct AbortState {
    SteerASRCancellation *token;
    Clock::time_point deadline;
};
SteerASRCancellation *steer_asr_cancellation_create() { return new SteerASRCancellation; }
void steer_asr_cancel(SteerASRCancellation *token) { if (token) token->cancelled.store(true); }
void steer_asr_cancellation_free(SteerASRCancellation *token) { delete token; }
static bool abort_inference(void *data) {
    auto &state = *static_cast<AbortState *>(data);
    return (state.token && state.token->cancelled.load()) || Clock::now() >= state.deadline;
}
static double milliseconds(Clock::time_point start) {
    return std::chrono::duration<double, std::milli>(Clock::now() - start).count();
}
static void quiet_log(enum ggml_log_level, const char *, void *) {}
int steer_asr_transcribe(const char *model, const float *samples, int count,
                        const char *language, int threads, int audio_context,
                        char *output, size_t capacity, SteerASRMetrics *metrics,
                        SteerASRCancellation *token) {
    if (!model || !samples || count <= 0 || count > 30 * WHISPER_SAMPLE_RATE || !output || !capacity || !metrics) return 1;
    *metrics = {}; output[0] = '\0';
    AbortState state{token, Clock::now() + std::chrono::seconds(25)};
    if (abort_inference(&state)) return 4;
    whisper_log_set(quiet_log, nullptr);
    auto setup = whisper_context_default_params();
    setup.use_gpu = false;
    auto started = Clock::now();
    auto *ctx = whisper_init_from_file_with_params(model, setup);
    metrics->load_ms = milliseconds(started);
    if (!ctx) return 2;
    auto params = whisper_full_default_params(WHISPER_SAMPLING_GREEDY);
    params.n_threads = std::max(1, std::min(threads, 4));
    params.no_context = true; params.no_timestamps = true;
    params.single_segment = true; params.print_progress = false;
    params.print_realtime = false; params.print_timestamps = false;
    params.language = language; params.translate = false;
    params.greedy.best_of = 1; params.temperature_inc = 0;
    params.max_tokens = 160;
    params.audio_ctx = audio_context;
    params.abort_callback = abort_inference; params.abort_callback_user_data = &state;
    started = Clock::now();
    const int result = abort_inference(&state) ? -1 : whisper_full(ctx, params, samples, count);
    metrics->recognition_ms = milliseconds(started);
    struct rusage usage{};
    if (getrusage(RUSAGE_SELF, &usage) == 0) metrics->peak_process_mb = usage.ru_maxrss / (1024.0 * 1024.0);
    std::string text;
    if (!result) for (int i = 0; i < whisper_full_n_segments(ctx); ++i) text += whisper_full_get_segment_text(ctx, i);
    whisper_free(ctx); // Release model and working buffers between utterances.
    if (abort_inference(&state)) return 4;
    if (result) return 3;
    if (text.size() >= capacity) return 5;
    std::memcpy(output, text.c_str(), text.size() + 1);
    return 0;
}

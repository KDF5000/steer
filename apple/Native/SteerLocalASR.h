#pragma once
#include <stddef.h>
#ifdef __cplusplus
extern "C" {
#endif
typedef struct SteerASRCancellation SteerASRCancellation;
typedef struct {
    double load_ms;
    double recognition_ms;
    double peak_process_mb;
} SteerASRMetrics;
SteerASRCancellation *steer_asr_cancellation_create(void);
void steer_asr_cancel(SteerASRCancellation *token);
void steer_asr_cancellation_free(SteerASRCancellation *token);
// 16 kHz mono floats. 0=success, 1=invalid input, 2=model load failed,
// 3=recognition failed, 4=cancelled/deadline, 5=output buffer too small.
int steer_asr_transcribe(const char *model, const float *samples, int count,
                        const char *language, int threads, int audio_context,
                        char *output, size_t capacity, SteerASRMetrics *metrics,
                        SteerASRCancellation *token);
#ifdef __cplusplus
}
#endif

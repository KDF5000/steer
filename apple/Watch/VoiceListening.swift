import SwiftUI

struct VoiceListening: View {
    @ObservedObject var dictation: Dictation
    var title = ""
    var onCancel: (() -> Void)? = nil
    @Environment(\.scenePhase) private var scenePhase
    var body: some View {
        ScrollView {
        VStack(spacing: 8) {
            if !title.isEmpty { Text(title).font(.caption2).foregroundStyle(.secondary).lineLimit(1) }
            if dictation.listening {
                Image(systemName: "waveform")
                    .font(.system(size: 26)).foregroundStyle(.mint)
                    .scaleEffect(0.85 + CGFloat(dictation.level) * 0.3)
                    .animation(.easeOut(duration: 0.1), value: dictation.level)
                Text("正在听…").font(.headline)
            } else {
                ProgressView().tint(.mint)
                Text(dictation.phase.isEmpty ? "准备聆听" : dictation.phase).font(.footnote).foregroundStyle(.secondary)
            }
            if dictation.listening {
                Button { dictation.finishSpeaking() } label: {
                    Text("完成").font(.footnote).foregroundStyle(.black)
                        .frame(maxWidth: .infinity, minHeight: 44).background(Color.mint, in: Capsule())
                }.buttonStyle(.plain)
            }
            Button(role: .cancel) { dictation.cancel(); onCancel?() } label: {
                Text("取消").font(.footnote).foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, minHeight: 44).contentShape(Rectangle())
            }.buttonStyle(.plain)
        }.padding(.horizontal, 8).padding(.vertical, 4)
        }
            .interactiveDismissDisabled()
            .onChange(of: scenePhase) { _, phase in if phase == .background { dictation.cancel() } }
    }
}

import Foundation

struct SpeechService: Codable, Equatable {
    var server: String
    var apiKey: String
    var baseURL: URL? {
        guard let url = URL(string: server.trimmingCharacters(in: .whitespacesAndNewlines)),
              ["http", "https"].contains(url.scheme?.lowercased() ?? ""), url.host != nil,
              url.user == nil, url.password == nil, url.query == nil, url.fragment == nil else { return nil }
        return url
    }
}

struct RemoteSpeech {
    let service: SpeechService
    var session: URLSession = .shared
    struct Health: Decodable { let ready: Bool }
    struct Transcript: Decodable {
        let text: String
        let request_id: String
    }
    private func perform(_ path: String, audio: Data? = nil) async throws -> Data {
        guard var url = service.baseURL, !service.apiKey.isEmpty else { throw APIError(message: "请先在 iPhone 配置语音服务地址和密钥") }
        url.append(path: path)
        var request = URLRequest(url: url)
        request.timeoutInterval = audio == nil ? 10 : 60
        request.setValue("Bearer \(service.apiKey)", forHTTPHeaderField: "Authorization")
        if let audio {
            request.httpMethod = "POST"
            request.setValue("audio/mp4", forHTTPHeaderField: "Content-Type")
            request.httpBody = audio
        }
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw APIError(message: "语音服务未返回有效响应") }
        guard (200...299).contains(http.statusCode) else {
            let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
            throw APIError(message: object?["error"] as? String ?? "语音服务请求失败（\(http.statusCode)）", statusCode: http.statusCode)
        }
        return data
    }
    func check() async throws {
        let health = try JSONDecoder().decode(Health.self, from: await perform("healthz"))
        guard health.ready else { throw APIError(message: "语音模型正在准备，请稍后重试") }
    }
    func transcribe(_ audio: Data) async throws -> String {
        guard !audio.isEmpty, audio.count <= 2 * 1024 * 1024 else { throw APIError(message: "录音为空或超过 2 MB") }
        let result = try JSONDecoder().decode(Transcript.self, from: await perform("v1/audio/transcriptions", audio: audio))
        let text = result.text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { throw APIError(message: "没有听清，请重新录音") }
        return text
    }
}

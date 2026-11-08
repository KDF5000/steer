import Foundation
import CryptoKit

// Chunking keeps each WatchConnectivity message below its payload limit.
// A complete, correctly ordered and verified recording is required for ASR.
struct VoiceUpload {
    static let maximumBytes = 1_048_576
    static let chunkBytes = 32_768
    let id: String
    let totalBytes: Int
    let digest: String
    let locale: String
    var received = Data()
    var nextSequence = 0
    let startedAt = Date()
    init(id: String, totalBytes: Int, digest: String, locale: String) throws {
        guard UUID(uuidString: id) != nil, totalBytes > 0, totalBytes <= Self.maximumBytes,
              digest.count == 64, digest.allSatisfy({ $0.isHexDigit }), !locale.isEmpty, locale.count <= 64 else {
            throw APIError(message: "录音参数无效")
        }
        self.id = id; self.totalBytes = totalBytes; self.digest = digest.lowercased(); self.locale = locale
    }
    mutating func append(_ bytes: Data, sequence: Int) throws {
        guard sequence == nextSequence, !bytes.isEmpty, bytes.count <= Self.chunkBytes,
              received.count + bytes.count <= totalBytes else { throw APIError(message: "录音传输不完整，请重试") }
        received.append(bytes); nextSequence += 1
    }
    func finish() throws -> Data {
        guard received.count == totalBytes, Self.hash(received) == digest else { throw APIError(message: "录音校验失败，请重试") }
        return received
    }
    static func hash(_ bytes: Data) -> String { SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined() }
}

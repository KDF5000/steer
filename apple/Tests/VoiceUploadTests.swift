import XCTest
#if SWIFT_PACKAGE
@testable import SteerCore
#endif

final class VoiceUploadTests: XCTestCase {
    func testRealAudioBytesSurviveChunking() throws {
        // Cover a recording larger than WatchConnectivity's per-message limit.
        let bytes = Data((0..<150_000).map { UInt8($0 % 251) })
        var upload = try VoiceUpload(id: UUID().uuidString, totalBytes: bytes.count, digest: VoiceUpload.hash(bytes), locale: "zh-CN")
        var seq = 0
        for offset in stride(from: 0, to: bytes.count, by: VoiceUpload.chunkBytes) {
            let part = bytes.subdata(in: offset..<min(offset + VoiceUpload.chunkBytes, bytes.count))
            try upload.append(part, sequence: seq); seq += 1
        }
        XCTAssertEqual(try upload.finish(), bytes)
        XCTAssertEqual(upload.nextSequence, 5)
    }
    func testMissingOutOfOrderAndCorruptAudioAreRejected() throws {
        let bytes = Data([1, 2, 3, 4])
        var upload = try VoiceUpload(id: UUID().uuidString, totalBytes: 4, digest: VoiceUpload.hash(bytes), locale: "zh-CN")
        XCTAssertThrowsError(try upload.append(Data([1]), sequence: 1))
        try upload.append(Data([1, 2]), sequence: 0)
        XCTAssertThrowsError(try upload.finish())
        XCTAssertThrowsError(try upload.append(Data([1]), sequence: 0))
        try upload.append(Data([3, 5]), sequence: 1)
        XCTAssertThrowsError(try upload.finish())
    }
    func testUploadBoundsProtectPhoneMemory() throws {
        XCTAssertThrowsError(try VoiceUpload(id: UUID().uuidString, totalBytes: VoiceUpload.maximumBytes + 1, digest: String(repeating: "0", count: 64), locale: "zh-CN"))
        XCTAssertThrowsError(try VoiceUpload(id: "invalid", totalBytes: 1, digest: String(repeating: "0", count: 64), locale: "zh-CN"))
        var upload = try VoiceUpload(id: UUID().uuidString, totalBytes: 40_000, digest: String(repeating: "0", count: 64), locale: "zh-CN")
        XCTAssertThrowsError(try upload.append(Data(repeating: 0, count: VoiceUpload.chunkBytes + 1), sequence: 0))
    }
}

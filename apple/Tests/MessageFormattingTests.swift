import XCTest
#if SWIFT_PACKAGE
@testable import SteerCore
#endif

final class MessageFormattingTests: XCTestCase {
    func testAgentReplySeparatesHeadingsListsAndParagraphs() {
        let source = "建议围绕 **runtime** 和 `model`。\n\n## 关键点\n- 保持 session\n  - 支持切换模型\n1. 验证状态\n\n> 不创建新会话\n> 保留上下文"
        XCTAssertEqual(MessageFormatting.blocks(source), [
            .paragraph("建议围绕 **runtime** 和 `model`。"), .heading(2, "关键点"),
            .listItem("•", "保持 session", 0), .listItem("•", "支持切换模型", 1),
            .listItem("1.", "验证状态", 0), .quote("不创建新会话\n保留上下文")
        ])
    }
    func testFencedCodeIsLiteralIncludingIncompleteStreamingBlock() {
        XCTAssertEqual(MessageFormatting.blocks("```swift\n# not a heading\n  let x = \"**literal**\"\n```\n结束"), [
            .code("swift", "# not a heading\n  let x = \"**literal**\""), .paragraph("结束")
        ])
        XCTAssertEqual(MessageFormatting.blocks("~~~~\n```\n- literal\n"), [.code("", "```\n- literal\n")])
    }
    func testTableAndWindowsNewlines() {
        XCTAssertEqual(MessageFormatting.blocks("| 方案 | 说明 |\r\n| :--- | ---: |\r\n| A | **本地** |\r\n\r\n尾段"), [
            .table([["方案", "说明"], ["A", "**本地**"]]), .paragraph("尾段")
        ])
        XCTAssertEqual(MessageFormatting.blocks("a | b\n普通文本"), [.paragraph("a | b\n普通文本")])
    }
}

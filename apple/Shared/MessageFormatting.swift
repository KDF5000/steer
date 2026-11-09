import Foundation

/// Small block parser for the Markdown returned by agents. Inline formatting is
/// handled by AttributedString in the native view; fenced code stays literal.
enum MessageBlock: Equatable {
    case paragraph(String)
    case heading(Int, String)
    case listItem(String, String, Int)
    case quote(String)
    case code(String, String)
    case table([[String]])
    case divider
}

enum MessageFormatting {
    static func blocks(_ source: String) -> [MessageBlock] {
        let lines = source.replacingOccurrences(of: "\r\n", with: "\n").components(separatedBy: "\n")
        var result: [MessageBlock] = []
        var paragraph: [String] = []
        var index = 0
        func flush() {
            if !paragraph.isEmpty { result.append(.paragraph(paragraph.joined(separator: "\n"))); paragraph = [] }
        }
        while index < lines.count {
            let line = lines[index]
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            if trimmed.isEmpty { flush(); index += 1; continue }
            if let fence = capture(#"^ {0,3}(`{3,}|~{3,})(.*)$"#, line) {
                flush()
                let marker = fence[0]
                var code: [String] = []
                index += 1
                while index < lines.count {
                    let closing = lines[index].trimmingCharacters(in: .whitespaces)
                    if closing.count >= marker.count && closing.allSatisfy({ $0 == marker.first! }) { index += 1; break }
                    code.append(lines[index]); index += 1
                }
                result.append(.code(fence[1].trimmingCharacters(in: .whitespaces), code.joined(separator: "\n")))
                continue
            }
            if let heading = capture(#"^ {0,3}(#{1,6})\s+(.+?)(?:\s+#+)?\s*$"#, line) {
                flush(); result.append(.heading(heading[0].count, heading[1])); index += 1; continue
            }
            if index + 1 < lines.count, line.contains("|"), isTableDivider(lines[index + 1]) {
                flush()
                var rows = [tableRow(line)]
                index += 2
                while index < lines.count, lines[index].contains("|"), !lines[index].trimmingCharacters(in: .whitespaces).isEmpty {
                    rows.append(tableRow(lines[index])); index += 1
                }
                result.append(.table(rows)); continue
            }
            if trimmed == "---" || trimmed == "***" || trimmed == "___" {
                flush(); result.append(.divider); index += 1; continue
            }
            if let list = capture(#"^(\s*)([-+*]|\d+[.)])\s+(.+)$"#, line) {
                flush()
                let marker = ["-", "+", "*"].contains(list[1]) ? "•" : list[1]
                result.append(.listItem(marker, list[2], min(list[0].count / 2, 4)))
                index += 1; continue
            }
            if trimmed.hasPrefix(">") {
                flush()
                var quote: [String] = []
                while index < lines.count {
                    let next = lines[index].trimmingCharacters(in: .whitespaces)
                    guard next.hasPrefix(">") else { break }
                    quote.append(String(next.dropFirst()).trimmingCharacters(in: .whitespaces)); index += 1
                }
                result.append(.quote(quote.joined(separator: "\n"))); continue
            }
            paragraph.append(line); index += 1
        }
        flush()
        return result
    }
    private static func capture(_ pattern: String, _ line: String) -> [String]? {
        guard let regex = try? NSRegularExpression(pattern: pattern),
              let match = regex.firstMatch(in: line, range: NSRange(line.startIndex..., in: line)) else { return nil }
        return (1..<match.numberOfRanges).map { index in
            guard let range = Range(match.range(at: index), in: line) else { return "" }
            return String(line[range])
        }
    }
    private static func tableRow(_ line: String) -> [String] {
        var line = line.trimmingCharacters(in: .whitespaces)
        if line.hasPrefix("|") { line.removeFirst() }
        if line.hasSuffix("|") { line.removeLast() }
        return line.components(separatedBy: "|").map { $0.trimmingCharacters(in: .whitespaces) }
    }
    private static func isTableDivider(_ line: String) -> Bool {
        let cells = tableRow(line)
        return !cells.isEmpty && cells.allSatisfy { capture(#"^(:?-{3,}:?)$"#, $0) != nil }
    }
}

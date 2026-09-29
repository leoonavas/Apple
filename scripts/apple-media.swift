import AppKit
import Foundation
import PDFKit
import Vision

enum MediaError: Error {
    case missingInput
    case unreadableImage
    case unreadablePDF
}

func recognize(_ image: CGImage) throws -> String {
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.recognitionLanguages = ["pt-BR", "en-US"]
    request.usesLanguageCorrection = true
    try VNImageRequestHandler(cgImage: image, options: [:]).perform([request])
    return (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }.joined(separator: "\n")
}

func recognizeImage(at url: URL) throws -> String {
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.recognitionLanguages = ["pt-BR", "en-US"]
    request.usesLanguageCorrection = true
    try VNImageRequestHandler(url: url, options: [:]).perform([request])
    return (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }.joined(separator: "\n")
}

func recognizePDF(at url: URL) throws -> String {
    guard let document = PDFDocument(url: url) else { throw MediaError.unreadablePDF }
    let digitalText = (0..<document.pageCount).compactMap { document.page(at: $0)?.string }.joined(separator: "\n")
    if digitalText.trimmingCharacters(in: .whitespacesAndNewlines).count > 15 { return digitalText }
    let pages = min(document.pageCount, 5)
    var results: [String] = []
    for index in 0..<pages {
        guard let page = document.page(at: index) else { continue }
        let thumbnail = page.thumbnail(of: CGSize(width: 1800, height: 2400), for: .mediaBox)
        var bounds = CGRect(origin: .zero, size: thumbnail.size)
        guard let image = thumbnail.cgImage(forProposedRect: &bounds, context: nil, hints: nil) else { continue }
        let text = try recognize(image)
        if !text.isEmpty { results.append(text) }
    }
    return results.joined(separator: "\n\n")
}

let arguments = Array(CommandLine.arguments.dropFirst())
guard arguments.count == 2 else { throw MediaError.missingInput }
let operation = arguments[0]
let url = URL(fileURLWithPath: arguments[1])
let output: String
switch operation {
case "ocr":
    if url.pathExtension.lowercased() == "pdf" {
        output = try recognizePDF(at: url)
    } else {
        output = try recognizeImage(at: url)
    }
default:
    throw MediaError.missingInput
}
print(output)

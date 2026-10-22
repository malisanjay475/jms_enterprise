import AppKit
import Foundation
import UniformTypeIdentifiers

/** Images (photos in chats, avatars) fetched with the Bearer token, kept in memory. */
actor ImageCache {
    static let shared = ImageCache()
    private var images: [String: NSImage] = [:]
    private var running: [String: Task<NSImage?, Never>] = [:]

    func image(_ path: String) async -> NSImage? {
        if let img = images[path] { return img }
        if let t = running[path] { return await t.value }
        let t = Task<NSImage?, Never> { (try? await Api.data(path)).flatMap { NSImage(data: $0) } }
        running[path] = t
        let img = await t.value
        running[path] = nil
        if let img {
            if images.count > 300 { images.removeAll() }
            images[path] = img
        }
        return img
    }
}

enum Media {
    static let maxBytes = 10 * 1024 * 1024

    /** Downloaded attachments: ~/Library/Caches/JMSChat/files. */
    static var filesDir: URL {
        let base = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
        let dir = base.appendingPathComponent("JMSChat/files", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    static func safeName(_ name: String) -> String {
        let bad = CharacterSet(charactersIn: "/\\:?%*|\"<>")
        let s = name.components(separatedBy: bad).joined(separator: "_")
        return s.isEmpty ? "file" : s
    }

    /** Downloads (once) and returns the local copy of an attachment. */
    static func localCopy(_ a: Attachment) async throws -> URL {
        let dest = filesDir.appendingPathComponent(String(a.syncId.prefix(8)) + "-" + safeName(a.fileName.isEmpty ? "file" : a.fileName))
        if FileManager.default.fileExists(atPath: dest.path) { return dest }
        let data = try await Api.data(Api.filePath(a.syncId))
        try data.write(to: dest, options: .atomic)
        return dest
    }

    /** Opens an attachment in its default app (Preview, QuickTime, Excel…). */
    @MainActor
    static func open(_ a: Attachment) async throws {
        NSWorkspace.shared.open(try await localCopy(a))
    }

    /** Save As… for an attachment. */
    @MainActor
    static func saveAs(_ a: Attachment) async throws {
        let panel = NSSavePanel()
        panel.nameFieldStringValue = safeName(a.fileName.isEmpty ? "file" : a.fileName)
        guard panel.runModal() == .OK, let url = panel.url else { return }
        let src = try await localCopy(a)
        try? FileManager.default.removeItem(at: url)
        try FileManager.default.copyItem(at: src, to: url)
    }

    /**
     * A file picked or dropped, ready to send. The server takes JPEG/PNG/GIF/WebP, PDF,
     * Excel (.xlsx), audio and MP4 up to 10 MB: other images (HEIC, TIFF, a big PNG)
     * are turned into a JPEG of at most 2048 px.
     */
    static func prepare(_ url: URL) throws -> (data: Data, name: String, mime: String) {
        let name = url.lastPathComponent
        let data = try Data(contentsOf: url)
        let type = UTType(filenameExtension: url.pathExtension)
        let direct: Set<String> = ["jpg", "jpeg", "png", "gif", "webp"]
        if let type, type.conforms(to: .image),
           !direct.contains(url.pathExtension.lowercased()) || data.count > maxBytes {
            guard let jpeg = jpeg(from: data) else { throw ApiError(message: "Could not read that picture.") }
            return (jpeg, (name as NSString).deletingPathExtension + ".jpg", "image/jpeg")
        }
        guard data.count <= maxBytes else { throw ApiError(message: "\(name) is larger than 10 MB.") }
        return (data, name, mimeType(for: name))
    }

    static func jpeg(from data: Data, maxSide: CGFloat = 2048) -> Data? {
        guard let src = NSImage(data: data), let rep = src.representations.first else { return nil }
        let w = CGFloat(rep.pixelsWide > 0 ? rep.pixelsWide : Int(src.size.width))
        let h = CGFloat(rep.pixelsHigh > 0 ? rep.pixelsHigh : Int(src.size.height))
        guard w > 0, h > 0 else { return nil }
        let scale = min(1, maxSide / max(w, h))
        let size = NSSize(width: (w * scale).rounded(), height: (h * scale).rounded())
        guard let bmp = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: Int(size.width), pixelsHigh: Int(size.height),
                                         bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
                                         colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0) else { return nil }
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: bmp)
        NSColor.white.setFill()
        NSRect(origin: .zero, size: size).fill()
        src.draw(in: NSRect(origin: .zero, size: size), from: .zero, operation: .sourceOver, fraction: 1)
        NSGraphicsContext.restoreGraphicsState()
        return bmp.representation(using: .jpeg, properties: [.compressionFactor: 0.82])
    }

    /** An image on the clipboard (a screenshot copied with ⌃⇧⌘4), as a temp PNG file. */
    static func pastedImageFile() -> URL? {
        let pb = NSPasteboard.general
        guard let img = NSImage(pasteboard: pb), let tiff = img.tiffRepresentation,
              let rep = NSBitmapImageRep(data: tiff), let png = rep.representation(using: .png, properties: [:]) else { return nil }
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("Pasted-\(Int(Date().timeIntervalSince1970)).png")
        guard (try? png.write(to: url)) != nil else { return nil }
        return url
    }

    static func sizeText(_ bytes: Int64) -> String {
        ByteCountFormatter.string(fromByteCount: bytes, countStyle: .file)
    }
}

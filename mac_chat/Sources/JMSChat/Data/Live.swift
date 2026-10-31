import Combine
import Foundation

/**
 * The live stream (/api/chat/stream, server-sent events). Reconnects with back-off and,
 * after a gap, emits a "reconnect" event so screens reload what they missed.
 */
@MainActor
final class Live: ObservableObject {
    static let shared = Live()

    @Published private(set) var connected = false
    let events = PassthroughSubject<LiveEvent, Never>()

    private var task: Task<Void, Never>?

    func start() {
        guard task == nil, Session.signedIn else { return }
        task = Task { [weak self] in await self?.run() }
    }

    func stop() {
        task?.cancel()
        task = nil
        connected = false
    }

    private func run() async {
        var attempt = 0
        var first = true
        while !Task.isCancelled && Session.signedIn {
            if !first { events.send(LiveEvent(type: "reconnect")) }
            first = false
            do {
                var req = Api.makeRequest("GET", "/api/chat/stream")
                req.setValue("text/event-stream", forHTTPHeaderField: "Accept")
                let (bytes, resp) = try await Api.streamSession.bytes(for: req)
                let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
                if code == 401 { Api.signedOutByServer(); break }
                guard code == 200 else { throw ApiError(message: "stream \(code)", status: code) }
                connected = true
                attempt = 0
                // The server writes one JSON object per "data:" line; ": hb" lines are heartbeats.
                for try await line in bytes.lines {
                    guard line.hasPrefix("data:") else { continue }
                    let json = line.dropFirst(5).trimmingCharacters(in: .whitespaces)
                    guard let d = json.data(using: .utf8),
                          let ev = try? JSONDecoder().decode(LiveEvent.self, from: d),
                          !ev.adminCopy, ev.type != "connected" else { continue }
                    events.send(ev)
                }
            } catch {
                if Task.isCancelled { break }
            }
            connected = false
            if Task.isCancelled { break }
            let wait = min(30.0, pow(2.0, Double(min(attempt, 5))))
            attempt += 1
            try? await Task.sleep(nanoseconds: UInt64(wait * 1_000_000_000))
        }
        connected = false
    }
}

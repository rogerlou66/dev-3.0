# dev3 for Android

This directory contains the Android tablet client. It keeps the computer-hosted `dev3 remote` process as the only authority for projects, tasks, terminals, and mutations.

The first vertical slice provides:

- QR or pasted-link connection to a LAN, Tailscale, SSH-forward, or HTTPS tunnel endpoint.
- The complete existing dev3 UI inside a hardened WebView.
- Exact-origin WebMessage bridging limited to the main frame.
- A native multiline prompt dock that does not send individual keystrokes through the WebView.
- Tri-state delivery: only confirmed task delivery clears a draft; ambiguous delivery never retries automatically.
- Android file-picker support for existing upload controls.
- Native notifications, clipboard writes, artifact save/open, external links, Back/IME handling, and task notification deep links.
- Same-origin streamed artifact downloads into Android's system file picker, without routing large ZIP files through the WebView bridge.
- Explicit computer-side folder and default-app actions for host paths, while ordinary browser sessions keep those invisible host effects hidden.
- Server-backed logout that revokes the rolling trusted session when the computer is forgotten.

## Build prerequisites

- Android Studio with JDK 17.
- Android SDK 37.
- The checked-in Gradle 9.5 wrapper.

Run `./gradlew testDebugUnitTest lintDebug assembleDebug` from this directory. JVM tests include Robolectric activity/lifecycle coverage; the compiled instrumentation APK remains the device-level smoke gate. The `Android client` GitHub Actions workflow runs the same gates and publishes the APK as the `dev3-android-debug` artifact.

## Run

1. On the computer, run `dev3 remote --no-tunnel` for LAN/Tailscale use or `dev3 remote` for an HTTPS quick tunnel.
2. Build and install the Android app from Android Studio.
3. Scan the printed QR code or paste its connection link.
4. Open a task terminal. The native prompt dock appears at the bottom; `Send` targets the task's live coding-agent pane, while `Insert` pastes into the visible terminal.

Public cleartext HTTP endpoints are rejected. Loopback/SSH and Tailscale addresses may use HTTP directly; other private LAN HTTP connections require an explicit warning confirmation and keep a persistent unencrypted indicator. Prefer HTTPS, SSH forwarding, or Tailscale for sensitive work.

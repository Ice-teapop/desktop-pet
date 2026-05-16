// DeskPet 前台 App 事件监听器（M3-3 C 方案，真 0 延迟）。
//
// 订阅 NSWorkspace.didActivateApplicationNotification —— macOS 内核级事件，
// 任何 app 切到前台立刻触发（μs 级），完全不用 poll。
//
// 协议：每行 stdout 写一个 app 名（utf-8 + \n），main 进程 spawn 这个 binary 后
// 用 readline 风格解析。binary 退出由父进程 SIGTERM。
//
// 编译：swiftc -O -target arm64-apple-macos11 -o resources/frontmost-listener \
//        resources/frontmost-listener.swift
// 输出是 native ARM64 binary，bundled 到 .app/Contents/Resources/。

import Foundation
import AppKit

let workspace = NSWorkspace.shared

func emit(_ name: String?) {
    let line = (name ?? "") + "\n"
    if let data = line.data(using: .utf8) {
        FileHandle.standardOutput.write(data)
    }
}

// 启动立刻报一次当前前台，让 main 进程不用等第一次切换
emit(workspace.frontmostApplication?.localizedName)

NotificationCenter.default.addObserver(
    forName: NSWorkspace.didActivateApplicationNotification,
    object: nil,
    queue: nil
) { notification in
    let app = notification.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication
    emit(app?.localizedName)
}

// 父进程退出时 SIGTERM 我们 —— 干净退出
signal(SIGTERM) { _ in exit(0) }
signal(SIGINT) { _ in exit(0) }
signal(SIGPIPE) { _ in exit(0) }  // main 关 stdin / stdout 我们也退

RunLoop.main.run()

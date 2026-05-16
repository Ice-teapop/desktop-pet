// DeskPet 前台 App 事件监听器（M3-3-H 三方会谈加固版，2026-05-16）。
//
// 三方诊断后的改进点：
//  - 补订阅 didLaunch / didHide / didUnhide / activeSpaceDidChange / didWake，覆盖
//    Cmd-Tab 回当前 app / Space 切换 / 系统唤醒等 didActivate 不触发的盲区
//  - SIGPIPE 忽略：pipe 满 / 父进程慢读时 write 返 EPIPE 让 errno 处理，不直接 exit
//  - emit "bundleID\tname\n" 双字段 TSV：bundleID 跨系统语言稳定，name 给 LLM 看
//  - 过滤 activationPolicy == .regular 排除 menubar app / daemon 短暂 frontmost
//  - 150ms 内部 coalesce 防 Mission Control / Space swipe 期间多次 fire
//  - 所有 callback 统一从 frontmostApplication 重读（单一真相源，不用 userInfo）
//
// 编译：swiftc -O -target arm64-apple-macos11 -o resources/frontmost-listener \
//        resources/frontmost-listener.swift

import Foundation
import AppKit

let workspace = NSWorkspace.shared

// SIGPIPE 忽略 —— pipe 满时 write 返 EPIPE 让 stdio 处理而非杀进程
signal(SIGPIPE, SIG_IGN)
signal(SIGTERM) { _ in exit(0) }
signal(SIGINT) { _ in exit(0) }

func emit(_ app: NSRunningApplication?) {
    // 过滤 activationPolicy: .regular（用户可见普通 app）—— 排除 menubar (.accessory)、
    // daemon (.prohibited)、login item 等短暂 frontmost 抖动
    guard let app = app, app.activationPolicy == .regular else { return }
    let bid = app.bundleIdentifier ?? ""
    let name = app.localizedName ?? ""
    if bid.isEmpty && name.isEmpty { return }
    let line = "\(bid)\t\(name)\n"
    if let data = line.data(using: .utf8) {
        FileHandle.standardOutput.write(data)
    }
}

// 150ms coalesce 队列 —— Mission Control / 三指 Space swipe 期间会触发 0.5s 内多次
// notification（Dock → Finder → 目标 app 抖动），合并到最后一次
var pendingEmit: DispatchWorkItem?
func scheduleEmit() {
    pendingEmit?.cancel()
    let work = DispatchWorkItem {
        emit(workspace.frontmostApplication)
    }
    pendingEmit = work
    DispatchQueue.main.asyncAfter(deadline: .now() + .milliseconds(150), execute: work)
}

// 启动立刻报一次当前 frontmost（无竞争场景直接 emit 不走 coalesce）
emit(workspace.frontmostApplication)

let nc = workspace.notificationCenter

// 订阅多个 NSWorkspace 通知 —— 任一触发都重读 frontmost（单一真相源），覆盖：
//   didActivate          —— 标准切换
//   didLaunch            —— 新 app 启动 + activate
//   didHide / didUnhide  —— 用户 Cmd-H 隐藏 / Dock 点回来 unhide
//   activeSpaceDidChange —— 多 Space 切换（即使两个 Space 顶层是同 app 也 fire 一次）
//   didWake              —— 系统唤醒后 frontmost 可能已变，必须重读
for name in [
    NSWorkspace.didActivateApplicationNotification,
    NSWorkspace.didLaunchApplicationNotification,
    NSWorkspace.didHideApplicationNotification,
    NSWorkspace.didUnhideApplicationNotification,
    NSWorkspace.activeSpaceDidChangeNotification,
    NSWorkspace.didWakeNotification
] {
    nc.addObserver(forName: name, object: nil, queue: nil) { _ in
        scheduleEmit()
    }
}

RunLoop.main.run()

/**
 * App — M0 占位桌宠（一个会呼吸的蓝色圆，验证透明窗口工作）。
 *
 * 验收点：跑起来后只能看见圆 + 阴影，看不到任何窗口边框或矩形背景。
 * 看到了 = transparent + frame:false + 渲染层透明背景 全链路工作。
 *
 * M1 把这里替换为：从 themes/<active>/theme.json 加载状态 → SVG 映射，
 * 按主进程推来的状态 ID 做交叉淡入。
 */

function App(): React.JSX.Element {
  return (
    <div className="stage">
      <div className="pet" aria-label="DeskPet M0 占位">
        <span>DeskPet</span>
        <small>M0</small>
      </div>
    </div>
  )
}

export default App

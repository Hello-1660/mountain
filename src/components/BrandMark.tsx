/**
 * Mountain 品牌图形 + 环境背景层
 *
 * 图形语言：地平线 + 双峰 + 高悬的日/月 + 缓慢公转的虚线轨道
 * 全部用 stroke 表现，并带循环描边动画（stroke-dashoffset），
 * 系统开启「减弱动态效果」时自动静止。
 */

export function MarkLogo({
  size = 30,
  animated = true,
}: {
  size?: number;
  animated?: boolean;
}) {
  const cls = animated ? "mark-stroke" : "";
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      aria-hidden
      focusable={false}
      className="mark-logo"
    >
      <path
        className={cls}
        style={{ "--dash": 150, animationDelay: "0s" } as React.CSSProperties}
        d="M5 45 L22 19 L32 33 L40 25 L59 45"
        stroke="currentColor"
        strokeWidth={3.4}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        className={cls}
        style={
          { "--dash": 62, animationDelay: "0.42s" } as React.CSSProperties
        }
        d="M10 51 H54"
        stroke="currentColor"
        strokeWidth={3}
        strokeLinecap="round"
        opacity={0.75}
      />
      <circle
        className={cls}
        style={
          { "--dash": 46, animationDelay: "0.84s" } as React.CSSProperties
        }
        cx={45}
        cy={14}
        r={6.4}
        stroke="currentColor"
        strokeWidth={3}
      />
    </svg>
  );
}

const RIDGE = "M5 45 L22 19 L32 33 L40 25 L59 45";

/** 背景上的大尺寸水印 logo：描边循环绘制 + 光点沿山脊巡游 + 双层公转轨道 */
export function WatermarkLogo({ size = 360 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      aria-hidden
      focusable={false}
    >
      <defs>
        <filter id="wm-glow" x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="1.6" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* 双层反向公转轨道 */}
      <g className="orbit-ring" style={{ transformOrigin: "32px 32px" }}>
        <circle
          cx={32}
          cy={32}
          r={27}
          stroke="currentColor"
          strokeWidth={0.5}
          strokeDasharray="2 6"
          opacity={0.5}
        />
      </g>
      <g
        className="orbit-ring-rev"
        style={{ transformOrigin: "32px 32px" }}
        opacity={0.4}
      >
        <circle
          cx={32}
          cy={32}
          r={34}
          stroke="currentColor"
          strokeWidth={0.4}
          strokeDasharray="1 9"
        />
      </g>

      <path
        className="mark-stroke"
        style={{ "--dash": 150, animationDelay: "0s" } as React.CSSProperties}
        d={RIDGE}
        stroke="currentColor"
        strokeWidth={1.1}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        className="mark-stroke"
        style={
          { "--dash": 62, animationDelay: "0.7s" } as React.CSSProperties
        }
        d="M10 51 H54"
        stroke="currentColor"
        strokeWidth={1}
        strokeLinecap="round"
        opacity={0.7}
      />
      <circle
        className="mark-stroke"
        style={
          { "--dash": 46, animationDelay: "1.4s" } as React.CSSProperties
        }
        cx={45}
        cy={14}
        r={6.4}
        stroke="currentColor"
        strokeWidth={1}
      />

      {/* 沿山脊巡游的光点（与描边同周期，视觉上像在"画"这座山） */}
      <g filter="url(#wm-glow)">
        <circle r={1.7} fill="currentColor">
          <animateMotion
            dur="6s"
            repeatCount="indefinite"
            path={RIDGE}
            keyPoints="0;1"
            keyTimes="0;1"
            calcMode="linear"
          />
        </circle>
      </g>
      {/* 沿地平线滑过的第二个光点 */}
      <circle r={1.2} fill="currentColor" opacity={0.8}>
        <animateMotion
          dur="9s"
          repeatCount="indefinite"
          path="M10 51 H54"
        />
      </circle>
    </svg>
  );
}

/**
 * 环境背景：三团独立游走的极光光斑 + 扫光 + 颗粒抖动 + 背景 logo + 暗角。
 * 光斑各自以不同周期/方向漂移，避免整层一起位移导致"看不出在动"。
 */
export function AmbientBackground({
  withLogo = true,
  logoSize = 360,
}: {
  withLogo?: boolean;
  logoSize?: number;
}) {
  return (
    <div className="app-bg" aria-hidden>
      <div className="app-bg__blob app-bg__blob--1" />
      <div className="app-bg__blob app-bg__blob--2" />
      <div className="app-bg__blob app-bg__blob--3" />
      <div className="app-bg__sheen" />
      {withLogo && (
        <div className="app-bg__logo">
          <WatermarkLogo size={logoSize} />
        </div>
      )}
      <div className="app-bg__grain" />
      <div className="app-bg__vignette" />
    </div>
  );
}

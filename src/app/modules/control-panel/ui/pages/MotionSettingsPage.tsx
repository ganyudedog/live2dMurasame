export default function MotionSettingsPage() {
  return (
    <div className="p-4 space-y-4">
      <div>
        <h1 className="text-lg font-semibold">动作设置</h1>
        <p className="text-xs text-base-content/60">配置模型的动作参数与触发规则</p>
      </div>

      <section className="rounded-box border border-base-300 bg-base-100 p-4 space-y-4">
        <div className="flex items-center justify-center h-40">
          <div className="text-center space-y-2">
            <div className="text-base-content/60">⚙️</div>
            <div className="text-sm text-base-content/60">功能开发中</div>
            <div className="text-xs text-base-content/40">
              动作设置功能将在后续版本中实现
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

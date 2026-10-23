/** 覆盖更新确认弹窗与彩蛋图弹层 */

export function UpdatePromptModal({
  currentVersion,
  version,
  installing,
  onCancel,
  onConfirm,
}: {
  currentVersion?: string;
  version: string;
  installing: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      className="lib-modal-mask"
      onClick={() => {
        if (!installing) onCancel();
      }}
    >
      <div
        className="lib-modal"
        role="dialog"
        aria-modal="true"
        aria-label="更新提示"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="lib-modal-title">发现新版本</h3>
        <p className="lib-modal-body">
          当前 v{currentVersion} → 新版本 v{version}
          <br />
          点击「立即更新」将下载安装包，随后自动重启并完成覆盖安装。
        </p>
        <div className="lib-modal-actions">
          <button
            type="button"
            className="btn btn--secondary"
            disabled={installing}
            onClick={onCancel}
          >
            取消
          </button>
          <button
            type="button"
            className="btn btn--primary"
            disabled={installing}
            onClick={onConfirm}
          >
            {installing ? "下载安装中…" : "立即更新"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function EasterModal({
  src,
  onClose,
}: {
  src: string;
  onClose: () => void;
}) {
  return (
    <div
      className="lib-modal-mask"
      onClick={onClose}
      role="dialog"
      aria-label="彩蛋图片"
    >
      <img
        className="lib-easter-img"
        src={src}
        alt="彩蛋"
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );
}

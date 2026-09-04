import { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RotateCcw, Home } from 'lucide-react';

interface Props {
  children: ReactNode;
  fallback?: (error: Error, reset: () => void) => ReactNode;
  onReset?: () => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[ErrorBoundary] Caught render error:', error, errorInfo);
  }

  public resetErrorBoundary = () => {
    if (this.props.onReset) {
      this.props.onReset();
    }
    this.setState({ hasError: false, error: null });
  };

  public render() {
    if (this.state.hasError) {
      if (this.props.fallback && this.state.error) {
        return this.props.fallback(this.state.error, this.resetErrorBoundary);
      }

      return (
        <div className="min-h-[400px] h-full flex flex-col items-center justify-center p-6 text-center bg-slate-900/90 rounded-3xl border border-red-900/40 text-slate-200">
          <div className="w-14 h-14 rounded-2xl bg-red-950/60 border border-red-500/30 flex items-center justify-center text-red-400 mb-4 shadow-lg">
            <AlertTriangle size={28} />
          </div>
          <h2 className="text-lg font-bold text-slate-100 mb-2">單字內容顯示發生異常</h2>
          <p className="text-sm text-slate-400 max-w-sm mb-6 leading-relaxed">
            單字資料結構已觸發保護機制，頁面未崩潰。您可以點擊下方按鈕重試或跳過此卡。
          </p>

          {this.state.error && (
            <div className="text-left w-full max-w-md p-3 mb-6 bg-slate-950/80 rounded-xl border border-red-900/30 font-mono text-xs text-red-300/80 overflow-x-auto">
              {this.state.error.message}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              onClick={this.resetErrorBoundary}
              className="flex items-center space-x-2 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-sm transition-all shadow-md active:scale-95"
            >
              <RotateCcw size={16} />
              <span>重新載入此頁</span>
            </button>
            <a
              href="#/"
              className="flex items-center space-x-2 px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium text-sm transition-all border border-slate-700"
            >
              <Home size={16} />
              <span>返回儀表板</span>
            </a>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

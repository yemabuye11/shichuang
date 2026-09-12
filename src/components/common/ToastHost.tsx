import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { Alert, Snackbar } from '@mui/material';

/**
 * 全站 Toast（轻量，不引第三方通知库）。
 *
 * 用法：
 * ```ts
 * const toast = useToast();
 * toast.success('链接已复制');
 * ```
 */

type ToastKind = 'success' | 'error' | 'info' | 'warning';

interface ToastState {
  open: boolean;
  message: string;
  kind: ToastKind;
}

interface ToastContextValue {
  /** 弹出一条提示。 */
  show: (message: string, kind?: ToastKind) => void;
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

/** Toast 宿主：包裹全应用一次（见 `App.tsx`）。 */
export function ToastHost({ children }: { children: ReactNode }): JSX.Element {
  const [state, setState] = useState<ToastState>({ open: false, message: '', kind: 'info' });

  const show = useCallback((message: string, kind: ToastKind = 'info') => {
    setState({ open: true, message, kind });
  }, []);

  const value = useMemo<ToastContextValue>(
    () => ({
      show,
      success: (m: string) => show(m, 'success'),
      error: (m: string) => show(m, 'error'),
      info: (m: string) => show(m, 'info'),
    }),
    [show],
  );

  const handleClose = (_event?: unknown, reason?: string): void => {
    if (reason === 'clickaway') return;
    setState((prev) => ({ ...prev, open: false }));
  };

  return (
    <ToastContext.Provider value={value}>
      {children}
      <Snackbar
        open={state.open}
        autoHideDuration={2600}
        onClose={handleClose}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        sx={{ bottom: { xs: 84, sm: 24 } }}
      >
        <Alert
          onClose={handleClose}
          severity={state.kind}
          variant="filled"
          sx={{ width: '100%', fontSize: 15, alignItems: 'center' }}
        >
          {state.message}
        </Alert>
      </Snackbar>
    </ToastContext.Provider>
  );
}

/**
 * 获取 Toast 句柄。
 *
 * @throws {Error} 在 `ToastHost` 之外使用时抛出。
 */
export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast 必须在 <ToastHost> 内部使用');
  return ctx;
}

export default ToastHost;

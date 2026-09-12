import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Box, Button, Container, Stack, Typography } from '@mui/material';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';

/**
 * 全局错误边界：任何未捕获的渲染异常都收敛为友好中文页，避免白屏。
 *
 * 教师是非程序员，错误页必须给出「能做什么」，而不是堆栈。
 */

export interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, message: error.message || '出了点小问题' };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // 仅在开发期打印堆栈，生产不向控制台泄露细节
    if (import.meta.env.DEV) {
      console.error('[ErrorBoundary]', error, info.componentStack);
    }
  }

  private handleReset = (): void => {
    this.setState({ hasError: false, message: '' });
  };

  private handleReload = (): void => {
    window.location.reload();
  };

  override render(): ReactNode {
    if (!this.state.hasError) return this.props.children;

    return (
      <Container maxWidth="sm" sx={{ py: 8 }}>
        <Stack spacing={2} alignItems="center" textAlign="center">
          <ErrorOutlineIcon sx={{ fontSize: 56, color: 'warning.main' }} />
          <Typography variant="h6" sx={{ fontWeight: 700 }}>
            页面出了点小问题
          </Typography>
          <Typography variant="body2" color="text.secondary">
            你的数据都还在，点下面的按钮重试就好；如果一直不行，刷新页面或联系我们。
          </Typography>
          <Stack direction="row" spacing={1.5}>
            <Button variant="contained" size="large" onClick={this.handleReset}>
              重试
            </Button>
            <Button variant="outlined" size="large" onClick={this.handleReload}>
              刷新页面
            </Button>
          </Stack>
          {import.meta.env.DEV ? (
            <Box
              component="pre"
              sx={{
                mt: 2,
                p: 2,
                width: '100%',
                overflow: 'auto',
                fontSize: 12,
                bgcolor: 'grey.100',
                borderRadius: 2,
                textAlign: 'left',
              }}
            >
              {this.state.message}
            </Box>
          ) : null}
        </Stack>
      </Container>
    );
  }
}

export default ErrorBoundary;

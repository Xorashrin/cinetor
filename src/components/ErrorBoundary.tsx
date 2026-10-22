import React, { Component, type ErrorInfo, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { MLogo } from './Logo';
import { Txt } from './Txt';
import { colors, radius } from '../theme/tokens';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
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

  public componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('ErrorBoundary caught startup/runtime error:', error, errorInfo);
  }

  public handleRestart = (): void => {
    this.setState({ hasError: false, error: null });
  };

  public render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <View style={styles.container}>
          <View style={styles.card}>
            <MLogo size={48} />
            <View style={styles.iconCircle}>
              <Ionicons name="warning-outline" size={32} color={colors.red} />
            </View>
            <Txt weight="bold" size={20} align="center" style={{ marginTop: 12 }}>
              Application Recovery
            </Txt>
            <Txt size={13} color={colors.textDim} align="center" style={styles.message}>
              {this.state.error?.message || 'An unexpected initialization error occurred.'}
            </Txt>
            <Pressable
              onPress={this.handleRestart}
              style={({ pressed }) => [styles.retryButton, pressed && { opacity: 0.8 }]}
            >
              <Ionicons name="refresh-outline" size={18} color="#FFFFFF" />
              <Txt weight="bold" size={15} color="#FFFFFF">
                Restart Cinator
              </Txt>
            </Pressable>
          </View>
        </View>
      );
    }

    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: '#161616',
    borderRadius: radius.lg,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#262626',
  },
  iconCircle: {
    marginTop: 16,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(229, 9, 20, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  message: {
    marginTop: 8,
    marginBottom: 20,
    lineHeight: 18,
  },
  retryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.red,
    borderRadius: radius.md,
    paddingVertical: 12,
    paddingHorizontal: 24,
    width: '100%',
  },
});

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Button } from '../src/components/ui/Button';
import { Badge } from '../src/components/ui/Badge';
import { AudioButton } from '../src/components/ui/AudioButton';
import { ProfileProvider } from '../src/contexts/ProfileContext';
import { SyncProvider } from '../src/contexts/SyncContext';
import { TypographyProvider } from '../src/contexts/TypographyContext';
import { ReviewStyleProvider } from '../src/contexts/ReviewStyleContext';
import { MemoryRouter } from 'react-router-dom';
import { FlashcardPage } from '../src/pages/FlashcardPage';
import { useWordImage, OFFLINE_PLACEHOLDER_URL } from '../src/services/imageService';

describe('UI Components Unit Tests', () => {
  it('renders Button component with variant styles and handles clicks', () => {
    const handleClick = vi.fn();
    render(<Button onClick={handleClick}>點擊開始</Button>);

    const btn = screen.getByRole('button', { name: '點擊開始' });
    expect(btn).toBeInTheDocument();
    fireEvent.click(btn);
    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  it('disables button when disabled prop is set', () => {
    render(<Button disabled>請先翻面</Button>);
    const btn = screen.getByRole('button', { name: '請先翻面' });
    expect(btn).toBeDisabled();
  });

  it('renders Badge with correct text', () => {
    render(<Badge variant="emerald">TOEIC 780-900</Badge>);
    expect(screen.getByText('TOEIC 780-900')).toBeInTheDocument();
  });

  it('renders AudioButton with accessible label', async () => {
    render(
      <ProfileProvider>
        <AudioButton headword="accommodate" />
      </ProfileProvider>
    );

    const audioBtn = await screen.findByRole('button', { name: '發音：accommodate' });
    expect(audioBtn).toBeInTheDocument();
  });

  it('useWordImage hook safely handles undefined, null, and transitions to valid word', () => {
    // Test custom hook stability across conditional renders
    const TestComponent: React.FC<{ headword?: string | null; category?: string; wordId?: string | null }> = ({ headword, category, wordId }) => {
      const imgInfo = useWordImage(headword, category, wordId);
      return <div data-testid="img-info" data-url={imgInfo.url} data-tag={imgInfo.tag}>{imgInfo.tag}</div>;
    };

    // 1. Initial render with undefined (simulating loading state)
    const { rerender } = render(<TestComponent headword={undefined} category={undefined} wordId={undefined} />);
    const el1 = screen.getByTestId('img-info');
    expect(el1.getAttribute('data-url')).toBe(OFFLINE_PLACEHOLDER_URL);
    expect(el1.getAttribute('data-tag')).toBe('載入中...');

    // 2. Rerender with null
    rerender(<TestComponent headword={null} category="辦公日常" wordId={null} />);
    expect(screen.getByTestId('img-info').getAttribute('data-url')).toBe(OFFLINE_PLACEHOLDER_URL);

    // 3. Rerender with real word once data loads
    rerender(<TestComponent headword="contract" category="商務契約" wordId="tw_w_test123" />);
    const el3 = screen.getByTestId('img-info');
    expect(el3.getAttribute('data-url')).toBeTruthy();
    expect(el3.getAttribute('data-tag')).toContain('contract');
  });

  it('FlashcardPage renders initial loading state without React hook order error #310', () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <MemoryRouter initialEntries={['/study?courseId=course-core-1200']}>
        <ProfileProvider>
          <SyncProvider>
            <TypographyProvider>
              <ReviewStyleProvider>
                <FlashcardPage />
              </ReviewStyleProvider>
            </TypographyProvider>
          </SyncProvider>
        </ProfileProvider>
      </MemoryRouter>
    );

    // Initial render shows loading screen
    expect(screen.getByText(/正在載入複習單字卡|本機尚未下載題庫/i)).toBeInTheDocument();

    // Verify React did NOT emit hook order error (#310)
    const hookErrorCalls = consoleErrorSpy.mock.calls.filter(args =>
      args.some(a => typeof a === 'string' && (a.includes('Rendered more hooks') || a.includes('order of Hooks')))
    );
    expect(hookErrorCalls.length).toBe(0);

    consoleErrorSpy.mockRestore();
  });
});

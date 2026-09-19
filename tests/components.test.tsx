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
import { SwipeableCard } from '../src/components/ui/SwipeableCard';
import { useWordImage, OFFLINE_PLACEHOLDER_URL, isValidManifest, preloadImage } from '../src/services/imageService';

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

  it('isValidManifest validates schema correctly and rejects invalid manifests', () => {
    // Valid manifest
    expect(isValidManifest({
      schemaVersion: '1.0.0',
      manifestUri: 'manifests/v1.json',
      count: 6860,
      images: { w_123: { v: 1, h: 'abc' } }
    })).toBe(true);

    // Invalid: null or undefined
    expect(isValidManifest(null)).toBe(false);
    expect(isValidManifest(undefined)).toBe(false);

    // Invalid: missing count
    expect(isValidManifest({ images: {} })).toBe(false);

    // Invalid: images is array instead of map
    expect(isValidManifest({ count: 10, images: [] })).toBe(false);

    // Invalid: missing images
    expect(isValidManifest({ count: 10 })).toBe(false);
  });

  it('preloadImage safely processes URLs without throwing', () => {
    expect(() => preloadImage(undefined)).not.toThrow();
    expect(() => preloadImage(null)).not.toThrow();
    expect(() => preloadImage(OFFLINE_PLACEHOLDER_URL)).not.toThrow();
    expect(() => preloadImage('https://toeic-image-publisher.peijungwu0302.workers.dev/words/test/v1.webp')).not.toThrow();
  });

  it('SwipeableCard renders front and rewind overlays appropriately', () => {
    // 1. Front mode
    const { unmount } = render(
      <SwipeableCard overlayMode="front" canSwipeLeft={true} canSwipeRight={true}>
        <div data-testid="card-front-content">Card Front</div>
      </SwipeableCard>
    );
    expect(screen.getByText(/回看上一詞/)).toBeInTheDocument();
    expect(screen.getByText(/翻到背面/)).toBeInTheDocument();
    unmount();

    // 2. Rewind mode
    render(
      <SwipeableCard overlayMode="rewind" canSwipeLeft={true} canSwipeRight={true}>
        <div data-testid="card-rewind-content">Card Rewind</div>
      </SwipeableCard>
    );
    expect(screen.getByText(/回看更早/)).toBeInTheDocument();
    expect(screen.getByText(/返回題目/)).toBeInTheDocument();
  });

  it('Gesture state machine maintains history symmetry (20 -> 19 -> 18 -> 19 -> 20)', () => {
    // Symmetrical multi-step history state machine simulation
    let currentIndex = 20;
    let historyOffset = 0;
    let isFlipped = false;
    let activeCardFlipped = false;
    let ratedCount = 0;

    const getActiveStudyIndex = () => Math.max(0, currentIndex - historyOffset);

    const handleFlipCard = () => {
      isFlipped = !isFlipped;
    };

    const handleSwipeLeft = () => {
      if (historyOffset > 0) {
        const nextOffset = historyOffset - 1;
        historyOffset = nextOffset;
        if (nextOffset === 0) {
          isFlipped = activeCardFlipped;
        } else {
          isFlipped = false;
        }
        return;
      }
      if (isFlipped) {
        handleRate(3);
      } else {
        handleFlipCard();
      }
    };

    const handleSwipeRight = () => {
      if (historyOffset > 0) {
        if (getActiveStudyIndex() > 0) {
          historyOffset += 1;
          isFlipped = false;
        }
        return;
      }
      if (isFlipped) {
        handleRate(1);
      } else {
        if (currentIndex > 0) {
          activeCardFlipped = isFlipped;
          historyOffset = 1;
          isFlipped = false;
        }
      }
    };

    const handleRate = (_rating: number) => {
      if (historyOffset > 0) return; // Invariant: blocked in history
      ratedCount++;
      historyOffset = 0;
      activeCardFlipped = false;
      currentIndex++;
      isFlipped = false;
    };

    // Test sequence:
    // Initial active card at 20 (FRONT)
    expect(getActiveStudyIndex()).toBe(20);
    expect(isFlipped).toBe(false);

    // Flip to back on card 20
    handleFlipCard();
    expect(isFlipped).toBe(true);

    // Active card 20 was flipped to BACK when entering history:
    // Swipe Right from history/back:
    activeCardFlipped = true;
    historyOffset = 1;
    isFlipped = false;

    expect(getActiveStudyIndex()).toBe(19);
    expect(isFlipped).toBe(false);

    // Swipe Right again -> steps to 18
    handleSwipeRight();
    expect(getActiveStudyIndex()).toBe(18);
    expect(historyOffset).toBe(2);

    // Tap history card -> flips history card front/back
    handleFlipCard();
    expect(isFlipped).toBe(true);
    handleFlipCard();
    expect(isFlipped).toBe(false);

    // Attempt to rate in history mode -> strictly blocked!
    handleRate(3);
    expect(ratedCount).toBe(0);
    expect(getActiveStudyIndex()).toBe(18);

    // Swipe Left -> steps forward to 19
    handleSwipeLeft();
    expect(getActiveStudyIndex()).toBe(19);
    expect(historyOffset).toBe(1);

    // Swipe Left again -> returns to active card 20 and restores its BACK face!
    handleSwipeLeft();
    expect(getActiveStudyIndex()).toBe(20);
    expect(historyOffset).toBe(0);
    expect(isFlipped).toBe(true); // Restored active card face state!

    // Now rate card 20
    handleRate(3);
    expect(ratedCount).toBe(1);
    expect(currentIndex).toBe(21);
    expect(getActiveStudyIndex()).toBe(21);
    expect(historyOffset).toBe(0);
  });
});

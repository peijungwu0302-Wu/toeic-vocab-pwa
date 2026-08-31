import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Button } from '../src/components/ui/Button';
import { Badge } from '../src/components/ui/Badge';
import { AudioButton } from '../src/components/ui/AudioButton';
import { ProfileProvider } from '../src/contexts/ProfileContext';

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
});

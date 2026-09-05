import React, { createContext, useContext, useState } from 'react';

export type ReviewStyle = 'swipe' | 'button';

interface ReviewStyleContextValue {
  reviewStyle: ReviewStyle;
  setReviewStyle: (style: ReviewStyle) => void;
}

const ReviewStyleContext = createContext<ReviewStyleContextValue>({
  reviewStyle: 'swipe',
  setReviewStyle: () => {}
});

export const ReviewStyleProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [reviewStyle, setReviewStyleState] = useState<ReviewStyle>(() => {
    const saved = localStorage.getItem('toeic_review_style');
    return (saved as ReviewStyle) || 'swipe';
  });

  const setReviewStyle = (style: ReviewStyle) => {
    setReviewStyleState(style);
    localStorage.setItem('toeic_review_style', style);
  };

  return (
    <ReviewStyleContext.Provider value={{ reviewStyle, setReviewStyle }}>
      {children}
    </ReviewStyleContext.Provider>
  );
};

export const useReviewStyle = () => useContext(ReviewStyleContext);

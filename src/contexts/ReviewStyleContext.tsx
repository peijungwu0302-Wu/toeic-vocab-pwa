import React, { createContext, useContext, useState } from 'react';

export type ReviewStyle = 'swipe' | 'button';
export type HandPreference = 'left' | 'right';

interface ReviewStyleContextValue {
  reviewStyle: ReviewStyle;
  setReviewStyle: (style: ReviewStyle) => void;
  handPreference: HandPreference;
  setHandPreference: (hand: HandPreference) => void;
}

const ReviewStyleContext = createContext<ReviewStyleContextValue>({
  reviewStyle: 'swipe',
  setReviewStyle: () => {},
  handPreference: 'left',
  setHandPreference: () => {}
});

export const ReviewStyleProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [reviewStyle, setReviewStyleState] = useState<ReviewStyle>(() => {
    const saved = localStorage.getItem('toeic_review_style');
    return (saved as ReviewStyle) || 'swipe';
  });

  const [handPreference, setHandPreferenceState] = useState<HandPreference>(() => {
    const saved = localStorage.getItem('toeic_hand_preference');
    return (saved as HandPreference) || 'left';
  });

  const setReviewStyle = (style: ReviewStyle) => {
    setReviewStyleState(style);
    localStorage.setItem('toeic_review_style', style);
  };

  const setHandPreference = (hand: HandPreference) => {
    setHandPreferenceState(hand);
    localStorage.setItem('toeic_hand_preference', hand);
  };

  return (
    <ReviewStyleContext.Provider
      value={{
        reviewStyle,
        setReviewStyle,
        handPreference,
        setHandPreference
      }}
    >
      {children}
    </ReviewStyleContext.Provider>
  );
};

export const useReviewStyle = () => useContext(ReviewStyleContext);


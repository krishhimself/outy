import { useEffect, useState } from "react";
import { Keyboard, KeyboardEvent, LayoutAnimation, Platform } from "react-native";

/**
 * Height of the on-screen keyboard on iOS (0 when hidden, and always 0 on
 * Android and web, where the system already moves the screen up).
 * Add it as bottom padding to a full-height screen so content sits exactly
 * on top of the keyboard.
 */
export function useKeyboardHeight(): number {
  const [height, setHeight] = useState(0);

  useEffect(() => {
    if (Platform.OS !== "ios") return;
    const animate = (e: KeyboardEvent) => {
      if (e.duration > 0) {
        LayoutAnimation.configureNext(
          LayoutAnimation.create(e.duration, LayoutAnimation.Types.keyboard, LayoutAnimation.Properties.opacity),
        );
      }
    };
    const show = Keyboard.addListener("keyboardWillShow", (e) => {
      animate(e);
      setHeight(e.endCoordinates.height);
    });
    const hide = Keyboard.addListener("keyboardWillHide", (e) => {
      animate(e);
      setHeight(0);
    });
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  return height;
}

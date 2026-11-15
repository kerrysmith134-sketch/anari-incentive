import type { KeyboardEvent } from "react";

/**
 * 可点击表格行的键盘可达性补丁：role/tabIndex + Enter/Space 激活。
 * 纯鼠标 onClick 的 <tr> 对键盘用户不可达（AUD-025）。
 */
export function clickableRowProps(onActivate: () => void) {
  return {
    role: "button" as const,
    tabIndex: 0,
    onClick: onActivate,
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        onActivate();
      }
    },
  };
}

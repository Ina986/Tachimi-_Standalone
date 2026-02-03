/**
 * タチミ - DOM操作ユーティリティ
 */

/**
 * IDで要素を取得（$関数）
 * @param {string} id - 要素ID
 * @returns {HTMLElement|null}
 */
export function $(id) {
    return document.getElementById(id);
}

/**
 * セレクタで単一要素を取得
 * @param {string} selector - CSSセレクタ
 * @param {HTMLElement} parent - 親要素（省略時はdocument）
 * @returns {HTMLElement|null}
 */
export function qs(selector, parent = document) {
    return parent.querySelector(selector);
}

/**
 * セレクタで複数要素を取得
 * @param {string} selector - CSSセレクタ
 * @param {HTMLElement} parent - 親要素（省略時はdocument）
 * @returns {NodeListOf<HTMLElement>}
 */
export function qsa(selector, parent = document) {
    return parent.querySelectorAll(selector);
}

/**
 * 要素を作成
 * @param {string} tag - タグ名
 * @param {Object} attrs - 属性
 * @param {string|HTMLElement|HTMLElement[]} children - 子要素
 * @returns {HTMLElement}
 */
export function createElement(tag, attrs = {}, children = null) {
    const el = document.createElement(tag);

    for (const [key, value] of Object.entries(attrs)) {
        if (key === 'className') {
            el.className = value;
        } else if (key === 'style' && typeof value === 'object') {
            Object.assign(el.style, value);
        } else if (key.startsWith('on') && typeof value === 'function') {
            el.addEventListener(key.slice(2).toLowerCase(), value);
        } else if (key === 'dataset' && typeof value === 'object') {
            Object.assign(el.dataset, value);
        } else {
            el.setAttribute(key, value);
        }
    }

    if (children) {
        if (typeof children === 'string') {
            el.textContent = children;
        } else if (Array.isArray(children)) {
            children.forEach(child => {
                if (typeof child === 'string') {
                    el.appendChild(document.createTextNode(child));
                } else if (child instanceof HTMLElement) {
                    el.appendChild(child);
                }
            });
        } else if (children instanceof HTMLElement) {
            el.appendChild(children);
        }
    }

    return el;
}

/**
 * 要素の表示/非表示を切り替え
 * @param {HTMLElement|string} el - 要素またはID
 * @param {boolean} visible - 表示するかどうか
 * @param {string} displayMode - 表示時のdisplay値
 */
export function setVisible(el, visible, displayMode = 'block') {
    const element = typeof el === 'string' ? $(el) : el;
    if (element) {
        element.style.display = visible ? displayMode : 'none';
    }
}

/**
 * クラスの追加/削除をトグル
 * @param {HTMLElement|string} el - 要素またはID
 * @param {string} className - クラス名
 * @param {boolean} force - 強制的に追加/削除
 */
export function toggleClass(el, className, force) {
    const element = typeof el === 'string' ? $(el) : el;
    if (element) {
        element.classList.toggle(className, force);
    }
}

/**
 * 要素にクラスを追加
 * @param {HTMLElement|string} el - 要素またはID
 * @param {...string} classNames - クラス名
 */
export function addClass(el, ...classNames) {
    const element = typeof el === 'string' ? $(el) : el;
    if (element) {
        element.classList.add(...classNames);
    }
}

/**
 * 要素からクラスを削除
 * @param {HTMLElement|string} el - 要素またはID
 * @param {...string} classNames - クラス名
 */
export function removeClass(el, ...classNames) {
    const element = typeof el === 'string' ? $(el) : el;
    if (element) {
        element.classList.remove(...classNames);
    }
}

/**
 * 要素の内容をクリア
 * @param {HTMLElement|string} el - 要素またはID
 */
export function clearContent(el) {
    const element = typeof el === 'string' ? $(el) : el;
    if (element) {
        element.innerHTML = '';
    }
}

/**
 * イベントリスナーを追加（解除関数を返す）
 * @param {HTMLElement|string} el - 要素またはID
 * @param {string} event - イベント名
 * @param {Function} handler - ハンドラ
 * @param {Object} options - イベントオプション
 * @returns {Function} 解除関数
 */
export function addEvent(el, event, handler, options = {}) {
    const element = typeof el === 'string' ? $(el) : el;
    if (element) {
        element.addEventListener(event, handler, options);
        return () => element.removeEventListener(event, handler, options);
    }
    return () => {};
}

/**
 * 複数のイベントリスナーを追加
 * @param {HTMLElement|string} el - 要素またはID
 * @param {Object} events - { eventName: handler } の形式
 * @returns {Function} 全解除関数
 */
export function addEvents(el, events) {
    const removers = Object.entries(events).map(([event, handler]) =>
        addEvent(el, event, handler)
    );
    return () => removers.forEach(remove => remove());
}

/**
 * 要素のサイズを取得
 * @param {HTMLElement|string} el - 要素またはID
 * @returns {{width: number, height: number}}
 */
export function getSize(el) {
    const element = typeof el === 'string' ? $(el) : el;
    if (element) {
        const rect = element.getBoundingClientRect();
        return { width: rect.width, height: rect.height };
    }
    return { width: 0, height: 0 };
}

/**
 * 要素の位置を取得
 * @param {HTMLElement|string} el - 要素またはID
 * @returns {{x: number, y: number}}
 */
export function getPosition(el) {
    const element = typeof el === 'string' ? $(el) : el;
    if (element) {
        const rect = element.getBoundingClientRect();
        return { x: rect.left, y: rect.top };
    }
    return { x: 0, y: 0 };
}

/**
 * 要素にフォーカス
 * @param {HTMLElement|string} el - 要素またはID
 * @param {number} delay - 遅延ミリ秒
 */
export function focusElement(el, delay = 0) {
    const element = typeof el === 'string' ? $(el) : el;
    if (element) {
        if (delay > 0) {
            setTimeout(() => element.focus(), delay);
        } else {
            element.focus();
        }
    }
}

/**
 * フォーム要素の値を取得
 * @param {HTMLElement|string} el - 要素またはID
 * @returns {*}
 */
export function getValue(el) {
    const element = typeof el === 'string' ? $(el) : el;
    if (!element) return null;

    if (element.type === 'checkbox') {
        return element.checked;
    } else if (element.type === 'number' || element.type === 'range') {
        return parseFloat(element.value) || 0;
    }
    return element.value;
}

/**
 * フォーム要素に値を設定
 * @param {HTMLElement|string} el - 要素またはID
 * @param {*} value - 設定する値
 */
export function setValue(el, value) {
    const element = typeof el === 'string' ? $(el) : el;
    if (!element) return;

    if (element.type === 'checkbox') {
        element.checked = Boolean(value);
    } else {
        element.value = value;
    }
}

// デフォルトエクスポート
export default {
    $,
    qs,
    qsa,
    createElement,
    setVisible,
    toggleClass,
    addClass,
    removeClass,
    clearContent,
    addEvent,
    addEvents,
    getSize,
    getPosition,
    focusElement,
    getValue,
    setValue
};

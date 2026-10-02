/**
 * Copyright 2026 SoTeen Studio
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

// Build expected text from digit groups independently of the production formatter.
export function expectedMoney(amount, { code = 'IDR', minorUnitDigits = 0 } = {}) {
  const digits = String(amount).padStart(minorUnitDigits + 1, '0');
  const integerLength = digits.length - minorUnitDigits;
  const groups = [];
  for (let end = integerLength; end > 0; end -= 3) {
    groups.unshift(digits.substring(Math.max(0, end - 3), end));
  }
  const fraction = minorUnitDigits ? ',' + digits.substring(integerLength) : '';
  return `${code} ${groups.join('.')}${fraction}`;
}

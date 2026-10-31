'use strict';

const chatWelcome = require('../src/modules/chat/chatWelcome');

describe('JMS Chat welcome message', () => {
  test('greets the person by name and points to the JMS Team', () => {
    const t = chatWelcome.welcomeText('Ravi Kumar');
    expect(t.startsWith('🙏 Namaste Ravi Kumar!')).toBe(true);
    expect(t).toContain('reply here and the JMS Team will help you');
    expect(t.endsWith('— Team JMS ✓')).toBe(true);
  });

  test('is sent by the JMS sender', () => {
    expect(chatWelcome.SENDER).toBe('JMS');
  });
});

import { generateOpaqueToken, hashOpaqueToken } from './opaque-token.util';

describe('opaque-token.util', () => {
  describe('generateOpaqueToken', () => {
    it('trả token không rỗng, mã hoá URL-safe', () => {
      const { token } = generateOpaqueToken();
      expect(token.length).toBeGreaterThan(0);
      // base64url: chỉ gồm A-Z a-z 0-9 - _ (không có + / =).
      expect(token).toMatch(/^[A-Za-z0-9\-_]+$/);
    });

    it('token đủ độ dài entropy (32 byte -> base64url dài hơn 40 ký tự)', () => {
      const { token } = generateOpaqueToken();
      expect(token.length).toBeGreaterThanOrEqual(40);
    });

    it('hai lần sinh cho hai token khác nhau và hai hash khác nhau', () => {
      const first = generateOpaqueToken();
      const second = generateOpaqueToken();
      expect(first.token).not.toBe(second.token);
      expect(first.tokenHash).not.toBe(second.tokenHash);
    });

    it('tokenHash trả về khác với token bản rõ', () => {
      const { token, tokenHash } = generateOpaqueToken();
      expect(tokenHash).not.toBe(token);
    });
  });

  describe('hashOpaqueToken', () => {
    it('băm xác định — cùng token luôn ra cùng hash', () => {
      const { token } = generateOpaqueToken();
      expect(hashOpaqueToken(token)).toBe(hashOpaqueToken(token));
    });

    it('khớp hash sinh ra cùng lúc với token', () => {
      const { token, tokenHash } = generateOpaqueToken();
      expect(hashOpaqueToken(token)).toBe(tokenHash);
    });

    it('token khác nhau cho hash khác nhau', () => {
      expect(hashOpaqueToken('token-a')).not.toBe(hashOpaqueToken('token-b'));
    });
  });
});

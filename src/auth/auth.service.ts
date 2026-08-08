import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'crypto';
import QRCode from 'qrcode';
import { UsersService } from '../users/users.service';
import { permissionsForRole } from '../common/permissions';

type MfaChallengePayload = {
  sub: string;
  tokenType: 'mfa-challenge';
  setupRequired: boolean;
};

@Injectable()
export class AuthService {
  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
  ) {}

  mfaRequiredFor(user: { role: string; mfaRequired?: boolean }) {
    return user.role !== 'superadmin' || user.mfaRequired !== false;
  }

  getMfaPolicy(actorId: string) {
    return this.usersService.getOwnMfaSettings(actorId);
  }

  updateMfaPolicy(enabled: boolean, actorId: string) {
    return this.usersService.updateOwnMfaSettings(actorId, enabled);
  }

  async validateUser(identifier: string, password: string) {
    const user = await this.usersService.findByLoginIdentifier(identifier);
    // Run a password comparison even when the account does not exist so login
    // timing does not reveal which email addresses are registered.
    const fallbackHash = '$2a$12$7.R0vCqsj5E1l9UUF9HL8e9uJzB7Jm4GMcJqVmF1CrqkQSiDEk/5K';
    const matches = await bcrypt.compare(password, user?.password || fallbackHash);
    if (!user || !matches) {
      throw new UnauthorizedException('Invalid email, user ID, or password');
    }

    if (user.isActive === false) {
      throw new UnauthorizedException('This account has been deactivated');
    }

    return user;
  }

  async beginMfaLogin(user: any) {
    const setupRequired = user.mfaEnabled !== true;
    const challengeToken = await this.createMfaChallenge(String(user._id), setupRequired);

    if (!setupRequired) {
      return {
        mfaRequired: true,
        setupRequired: false,
        challengeToken,
      };
    }

    const secret = this.base32Encode(randomBytes(20));
    await this.usersService.beginMfaSetup(String(user._id), this.encryptSecret(secret));

    const issuer = (process.env.MFA_ISSUER || 'Beone Production').trim();
    const accountLabel = user.userId || user.email;
    const label = `${issuer}:${accountLabel}`;
    const otpauthUrl = `otpauth://totp/${encodeURIComponent(label)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
    const qrCodeDataUrl = await QRCode.toDataURL(otpauthUrl, {
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 240,
    });

    return {
      mfaRequired: true,
      setupRequired: true,
      challengeToken,
      qrCodeDataUrl,
      manualKey: secret.match(/.{1,4}/g)?.join(' ') || secret,
      issuer,
      accountLabel,
    };
  }

  async verifyMfa(challengeToken: string, submittedCode: string) {
    const challenge = await this.verifyMfaChallenge(challengeToken);
    const account = await this.usersService.findByIdForMfa(challenge.sub);
    if (account.isActive === false) {
      throw new UnauthorizedException('This account has been deactivated');
    }

    if (challenge.setupRequired) {
      if (account.mfaEnabled) {
        throw new ConflictException('Authenticator setup has already completed. Sign in again.');
      }
      if (!account.mfaSecretEncrypted) {
        throw new UnauthorizedException('Authenticator setup expired. Sign in again.');
      }
      const step = this.verifyTotp(this.decryptSecret(account.mfaSecretEncrypted), submittedCode);
      if (step === null) throw new UnauthorizedException('Invalid authenticator code');

      const recoveryCodes = this.createRecoveryCodes();
      const recoveryCodeHashes = recoveryCodes.map((code) => this.hashRecoveryCode(code));
      const user = await this.usersService.enableMfa(challenge.sub, recoveryCodeHashes, step);
      return { user, recoveryCodes };
    }

    if (!account.mfaEnabled || !account.mfaSecretEncrypted) {
      throw new UnauthorizedException('Authenticator was reset. Sign in again to set it up.');
    }

    const normalizedCode = submittedCode.trim();
    if (/^\d{6}$/.test(normalizedCode)) {
      const step = this.verifyTotp(this.decryptSecret(account.mfaSecretEncrypted), normalizedCode);
      if (step === null) throw new UnauthorizedException('Invalid authenticator code');
      const user = await this.usersService.recordMfaTotpUse(challenge.sub, step);
      return { user, recoveryCodes: undefined };
    }

    const recoveryCodeHash = this.hashRecoveryCode(normalizedCode);
    const user = await this.usersService.consumeMfaRecoveryCode(challenge.sub, recoveryCodeHash);
    return { user, recoveryCodes: undefined };
  }

  async signTokens(
    user: { _id: any; name: string; role: string },
    options: { mfaBypassed?: boolean } = {},
  ) {
    const permissions = permissionsForRole(user.role);
    const accessPayload = {
      sub: user._id,
      name: user.name,
      role: user.role,
      permissions,
      tokenType: 'access',
      mfaVerified: true,
      mfaBypassed: options.mfaBypassed === true,
    };
    const refreshPayload = {
      sub: user._id,
      tokenType: 'refresh',
      mfaVerified: true,
      mfaBypassed: options.mfaBypassed === true,
    };

    const accessToken = await this.jwtService.signAsync(accessPayload, {
      secret: process.env.JWT_ACCESS_SECRET,
      expiresIn: (process.env.JWT_ACCESS_EXPIRES || '15m') as any,
    });

    const refreshToken = await this.jwtService.signAsync(refreshPayload, {
      secret: process.env.JWT_REFRESH_SECRET,
      expiresIn: (process.env.JWT_REFRESH_EXPIRES || '7d') as any,
    });

    return { accessToken, refreshToken };
  }

  private async createMfaChallenge(userId: string, setupRequired: boolean) {
    return this.jwtService.signAsync(
      { sub: userId, tokenType: 'mfa-challenge', setupRequired },
      {
        secret: this.mfaChallengeSecret(),
        expiresIn: (process.env.MFA_CHALLENGE_EXPIRES || '5m') as any,
      },
    );
  }

  private async verifyMfaChallenge(token: string): Promise<MfaChallengePayload> {
    try {
      const payload = await this.jwtService.verifyAsync<MfaChallengePayload>(token, {
        secret: this.mfaChallengeSecret(),
      });
      if (payload.tokenType !== 'mfa-challenge' || !payload.sub) throw new Error('Invalid challenge');
      return payload;
    } catch {
      throw new UnauthorizedException('Sign-in verification expired. Enter your password again.');
    }
  }

  private mfaChallengeSecret() {
    const secret = process.env.MFA_CHALLENGE_SECRET || process.env.JWT_ACCESS_SECRET;
    if (!secret) throw new Error('MFA_CHALLENGE_SECRET or JWT_ACCESS_SECRET must be configured');
    return secret;
  }

  private mfaEncryptionKey() {
    const secret = process.env.MFA_ENCRYPTION_KEY || process.env.JWT_REFRESH_SECRET;
    if (!secret) throw new Error('MFA_ENCRYPTION_KEY or JWT_REFRESH_SECRET must be configured');
    return createHash('sha256').update(secret, 'utf8').digest();
  }

  private encryptSecret(secret: string) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.mfaEncryptionKey(), iv);
    const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return ['v1', iv.toString('base64url'), authTag.toString('base64url'), encrypted.toString('base64url')].join(':');
  }

  private decryptSecret(value: string) {
    try {
      const [version, iv, authTag, encrypted] = value.split(':');
      if (version !== 'v1' || !iv || !authTag || !encrypted) throw new Error('Invalid encrypted value');
      const decipher = createDecipheriv('aes-256-gcm', this.mfaEncryptionKey(), Buffer.from(iv, 'base64url'));
      decipher.setAuthTag(Buffer.from(authTag, 'base64url'));
      return Buffer.concat([
        decipher.update(Buffer.from(encrypted, 'base64url')),
        decipher.final(),
      ]).toString('utf8');
    } catch {
      throw new UnauthorizedException('Authenticator configuration is unavailable. Ask a superadmin to reset it.');
    }
  }

  private base32Encode(buffer: Buffer) {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    let bits = 0;
    let value = 0;
    let output = '';
    for (const byte of buffer) {
      value = (value << 8) | byte;
      bits += 8;
      while (bits >= 5) {
        output += alphabet[(value >>> (bits - 5)) & 31];
        bits -= 5;
      }
    }
    if (bits > 0) output += alphabet[(value << (5 - bits)) & 31];
    return output;
  }

  private base32Decode(input: string) {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    let bits = 0;
    let value = 0;
    const output: number[] = [];
    for (const character of input.replace(/=+$/g, '').toUpperCase()) {
      const index = alphabet.indexOf(character);
      if (index < 0) throw new Error('Invalid base32 secret');
      value = (value << 5) | index;
      bits += 5;
      if (bits >= 8) {
        output.push((value >>> (bits - 8)) & 255);
        bits -= 8;
      }
    }
    return Buffer.from(output);
  }

  private totpAtStep(secret: string, step: number) {
    const counter = Buffer.alloc(8);
    counter.writeBigUInt64BE(BigInt(step));
    const digest = createHmac('sha1', this.base32Decode(secret)).update(counter).digest();
    const offset = digest[digest.length - 1] & 0x0f;
    const binary = ((digest[offset] & 0x7f) << 24)
      | ((digest[offset + 1] & 0xff) << 16)
      | ((digest[offset + 2] & 0xff) << 8)
      | (digest[offset + 3] & 0xff);
    return String(binary % 1_000_000).padStart(6, '0');
  }

  private verifyTotp(secret: string, submittedCode: string) {
    const code = submittedCode.trim();
    if (!/^\d{6}$/.test(code)) return null;
    const currentStep = Math.floor(Date.now() / 30_000);
    for (const offset of [0, -1, 1]) {
      const step = currentStep + offset;
      const expected = Buffer.from(this.totpAtStep(secret, step));
      const actual = Buffer.from(code);
      if (expected.length === actual.length && timingSafeEqual(expected, actual)) return step;
    }
    return null;
  }

  private normalizeRecoveryCode(code: string) {
    return code.trim().replace(/[\s-]/g, '').toUpperCase();
  }

  private hashRecoveryCode(code: string) {
    return createHmac('sha256', this.mfaEncryptionKey())
      .update(this.normalizeRecoveryCode(code), 'utf8')
      .digest('hex');
  }

  private createRecoveryCodes() {
    return Array.from({ length: 8 }, () => {
      const value = randomBytes(8).toString('hex').toUpperCase();
      return value.match(/.{1,4}/g)?.join('-') || value;
    });
  }

  private durationMs(value: string | undefined, fallback: number) {
    if (!value) return fallback;
    const match = value.trim().match(/^(\d+)(ms|s|m|h|d)$/i);
    if (!match) return fallback;
    const amount = Number(match[1]);
    const units: Record<string, number> = {
      ms: 1,
      s: 1000,
      m: 60_000,
      h: 3_600_000,
      d: 86_400_000,
    };
    return amount * units[match[2].toLowerCase()];
  }

  accessCookieMaxAge() {
    return this.durationMs(process.env.JWT_ACCESS_EXPIRES, 15 * 60_000);
  }

  refreshCookieMaxAge() {
    return this.durationMs(process.env.JWT_REFRESH_EXPIRES, 7 * 24 * 60 * 60_000);
  }

  cookieOptions(maxAgeMs?: number) {
    return {
      httpOnly: true,
      secure: process.env.COOKIE_SECURE !== 'false',
      sameSite: 'lax' as const,
      ...(maxAgeMs === undefined ? {} : { maxAge: maxAgeMs }),
      path: '/',
    };
  }
}

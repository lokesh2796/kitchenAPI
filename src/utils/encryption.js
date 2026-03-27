const crypto = require('crypto');

const ALGORITHM = 'aes-256-cbc';
// Ensure SECRET_KEY is 32 chars. If not, we might need to hash it or pad it. 
// For simplicity, we assume the user provides a good key or we derive one.
// We'll use a hashed version of the env key to ensure 32 bytes.
const getSecretKey = () => {
    const key = process.env.SECRET_KEY || 'default_secret_key_change_me_in_env';
    return crypto.createHash('sha256').update(key).digest();
};

const IV_LENGTH = 16;

exports.encrypt = (text) => {
    if (!text) return null;
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, getSecretKey(), iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return iv.toString('hex') + ':' + encrypted;
};

exports.decrypt = (text) => {
    if (!text) return null;
    try {
        const textParts = text.split(':');
        const iv = Buffer.from(textParts.shift(), 'hex');
        const encryptedText = textParts.join(':');
        const decipher = crypto.createDecipheriv(ALGORITHM, getSecretKey(), iv);
        let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
    } catch (err) {
        console.error('Decryption failed:', err.message);
        return null; // Or throw error
    }
};

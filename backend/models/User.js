import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const userSchema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true },
  username: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true },
  role: { type: String, enum: ['VIEWER', 'MERCHANDISER', 'ADMIN'], required: true, default: 'VIEWER' },
  name: { type: String, required: true }
}, { timestamps: true });

userSchema.methods.comparePassword = async function(candidatePassword) {
  return bcrypt.compare(candidatePassword, this.passwordHash);
};

export const DEFAULT_SEEDED_USERS = [
  {
    userId: 'usr_admin_01',
    username: 'admin',
    password: 'adminpassword123',
    role: 'ADMIN',
    name: 'Admin User'
  },
  {
    userId: 'usr_merch_01',
    username: 'merchandiser',
    password: 'merchpassword123',
    role: 'MERCHANDISER',
    name: 'Merchandiser User'
  },
  {
    userId: 'usr_viewer_01',
    username: 'viewer',
    password: 'viewerpassword123',
    role: 'VIEWER',
    name: 'Viewer User'
  }
];

export async function seedDefaultUsers() {
  for (const u of DEFAULT_SEEDED_USERS) {
    const existing = await mongoose.model('User').findOne({ username: u.username });
    if (!existing) {
      const passwordHash = await bcrypt.hash(u.password, 10);
      await mongoose.model('User').create({
        userId: u.userId,
        username: u.username,
        passwordHash,
        role: u.role,
        name: u.name
      });
    }
  }
}

const User = mongoose.model('User', userSchema);
export default User;

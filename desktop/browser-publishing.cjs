const PLATFORM_PAGES = Object.freeze({
  youtube: { signIn: 'https://accounts.google.com/ServiceLogin?service=youtube', upload: 'https://www.youtube.com/upload' },
  tiktok: { signIn: 'https://www.tiktok.com/login', upload: 'https://www.tiktok.com/tiktokstudio/upload' },
  facebook: { signIn: 'https://www.facebook.com/login/', upload: 'https://www.facebook.com/' },
  instagram: { signIn: 'https://www.instagram.com/accounts/login/', upload: 'https://www.instagram.com/' }
});
module.exports = { PLATFORM_PAGES };

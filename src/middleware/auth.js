export function requireAuth(req, res, next) {
  if (req.session && req.session.authed) return next();
  return res.redirect('/login');
}

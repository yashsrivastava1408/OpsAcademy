/** Express 4 does not catch rejected promises from async handlers; forward them to the error middleware. */
module.exports = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

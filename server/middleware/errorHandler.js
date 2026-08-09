import logger from '../utils/logger.js';

/**
 * Global error handling middleware for Express.
 */
export function errorHandler(err, req, res, _next) {
  logger.error('Unhandled error', {
    error: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
  });

  // Multer errors
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({
      error: 'File too large',
      message: 'The uploaded file exceeds the maximum size of 100MB.',
    });
  }

  if (err.message === 'Only .epub files are allowed') {
    return res.status(400).json({
      error: 'Invalid file type',
      message: 'Please upload a valid EPUB file (.epub extension).',
    });
  }

  // Default error
  const statusCode = err.statusCode || 500;
  res.status(statusCode).json({
    error: err.message || 'Internal server error',
    message:
      statusCode === 500
        ? 'Something went wrong. Please try again.'
        : err.message,
  });
}

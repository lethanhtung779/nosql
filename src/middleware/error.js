function notFound(req, res) {
  res.status(404).json({ message: 'Không tìm thấy tài nguyên' });
}

function errorHandler(error, req, res, next) {
  if (res.headersSent) return next(error);
  if (error.code === 11000) return res.status(409).json({ message: 'Dữ liệu đã tồn tại', detail: error.keyValue });
  console.error(error);
  res.status(error.status || 500).json({ message: error.status ? error.message : 'Lỗi máy chủ' });
}

module.exports = { notFound, errorHandler };

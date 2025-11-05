const aws = require('aws-sdk')
const multer = require('multer')
const multerS3 = require('multer-s3');
const path = require('path');
const fs = require('fs');

// If AWS credentials are present, use S3 + multer-s3. Otherwise fallback to local disk storage
const usingS3 = process.env.AWS_IAM_USER_KEY && process.env.AWS_IAM_USER_SECRET && process.env.AWS_BUCKET_NAME;

let s3Config;
if (usingS3) {
    s3Config = new aws.S3({
        accessKeyId: process.env.AWS_IAM_USER_KEY,
        secretAccessKey: process.env.AWS_IAM_USER_SECRET,
        Bucket: process.env.AWS_BUCKET_NAME
    });
}

if (usingS3) {
    const avatarS3Config = multerS3({
        s3: s3Config,
        bucket: process.env.AWS_BUCKET_NAME,
        acl: 'public-read',
        metadata: function (req, file, cb) {
            cb(null, { fieldName: file.fieldname });
        },
        key: function (req, file, cb) {
            const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9)
            cb(null, "profiles/" + file.fieldname + '_' + uniqueSuffix + path.extname(file.originalname))
        }
    });

    const postS3Config = multerS3({
        s3: s3Config,
        bucket: process.env.AWS_BUCKET_NAME,
        acl: 'public-read',
        metadata: function (req, file, cb) {
            cb(null, { fieldName: file.fieldname });
        },
        key: function (req, file, cb) {
            const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9)
            cb(null, "posts/" + file.fieldname + '_' + uniqueSuffix + path.extname(file.originalname))
        }
    });

    exports.uploadAvatar = multer({
        storage: avatarS3Config,
        limits: {
            fileSize: 1024 * 1024 * 5
        }
    });

    exports.uploadPost = multer({
        storage: postS3Config,
        limits: {
            fileSize: 1024 * 1024 * 5
        }
    });

    exports.deleteFile = async (fileuri) => {
        const fileKey = fileuri.split('/').slice(-2).join("/");
        return await s3Config.deleteObject({
            Bucket: process.env.AWS_BUCKET_NAME,
            Key: fileKey
        }).promise();
    }

} else {
    // Local disk storage fallback. Files will be saved under ./public/uploads/{profiles,posts}
    const ensureDir = (dir) => {
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    }

    const avatarStorage = multer.diskStorage({
        destination: function (req, file, cb) {
            const dir = path.join(__dirname, '..', 'public', 'uploads', 'profiles');
            ensureDir(dir);
            cb(null, dir);
        },
        filename: function (req, file, cb) {
            const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9)
            cb(null, file.fieldname + '_' + uniqueSuffix + path.extname(file.originalname))
        }
    });

    const postStorage = multer.diskStorage({
        destination: function (req, file, cb) {
            const dir = path.join(__dirname, '..', 'public', 'uploads', 'posts');
            ensureDir(dir);
            cb(null, dir);
        },
        filename: function (req, file, cb) {
            const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9)
            cb(null, file.fieldname + '_' + uniqueSuffix + path.extname(file.originalname))
        }
    });

    const avatarUpload = multer({
        storage: avatarStorage,
        limits: { fileSize: 1024 * 1024 * 5 }
    });

    const postUpload = multer({
        storage: postStorage,
        limits: { fileSize: 1024 * 1024 * 5 }
    });

    // Provide an API compatible with multer's interface: upload.single(field)
    // so existing route code can call uploadAvatar.single('avatar') and uploadPost.single('post')
    exports.uploadAvatar = {
        single: (field) => (req, res, next) => {
            avatarUpload.single(field)(req, res, function (err) {
                if (err) return next(err);
                if (req.file) {
                    // build public URL for the saved file
                    const host = req.get('host');
                    const protocol = req.protocol;
                    req.file.location = `${protocol}://${host}/public/uploads/profiles/${req.file.filename}`;
                }
                next();
            });
        }
    };

    exports.uploadPost = {
        single: (field) => (req, res, next) => {
            postUpload.single(field)(req, res, function (err) {
                if (err) return next(err);
                if (req.file) {
                    const host = req.get('host');
                    const protocol = req.protocol;
                    req.file.location = `${protocol}://${host}/public/uploads/posts/${req.file.filename}`;
                }
                next();
            });
        }
    };

    exports.deleteFile = async (fileuri) => {
        // fileuri expected to be something like http://host/public/uploads/posts/filename.jpg
        try {
            const idx = fileuri.indexOf('/public/');
            if (idx === -1) return;
            const relative = fileuri.substring(idx + 1); // remove leading '/'
            const filepath = path.join(__dirname, '..', relative);
            if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
        } catch (err) {
            // ignore delete errors for now
            console.error('deleteFile error:', err.message);
        }
    }

}
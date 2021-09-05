require('dotenv').config()
const fs = require("fs")
const S3 = require("aws-sdk/clients/s3")

const bucketName = process.env.AWS_BUCKET_NAME
const region = process.env.AWS_BUCKET_REGION
const accessKeyId = process.env.AWS_ACCESS_KEY
const secretAccessKey = process.env.AWS_SECRET_KEY

const s3 = new S3({
region,
accessKeyId,
secretAccessKey
})
 
function uploadFile(file){
    const type = file.mimetype.split('/')[1];
    // console.log("MimeType --", type);

    const fileStream = fs.createReadStream(file.path);

    const uploadParams = {
        Bucket: bucketName,
        Body: fileStream,
        Key: file.filename + `.${type}`,
        ACL: 'public-read'
    };

    return s3.upload(uploadParams).promise();

}

async function deleteFile(file){
    console.log("File Name - ", file);

    const deleteParams = {
        Bucket: bucketName,
        Key: `${file}`
    };

    return s3.deleteObject(deleteParams, function(err, data){
        if(err) {
            // console.log("Error S3 - ", err);
            return err;
        }
        else {
            console.log("Data S3 - ", data);
            return data;
        };
    });
}

exports.uploadFile = uploadFile;
exports.deleteFile = deleteFile;
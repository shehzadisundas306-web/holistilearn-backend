import nodemailer from 'nodemailer'
import 'dotenv/config'

export const sendOtpMail = async( email , otp)=>{
    const transporter = nodemailer.createTransport({
        service: 'gmail', 
        auth: {
            user: process.env.MAIL_USER,
            pass: process.env.MAIL_PASSWORD
        }
    })
    const mailOptions = {
        from: process.env.MAIL_USER,
        to: email,
        subject: 'password reset otp',
        html:`<p>Your otp for password reset is <b>${otp}</b></p>`
    }
    await transporter.sendMail(mailOptions)
}
import yup from 'yup'

export const userSchema = yup.object({
    username: yup.string().trim().min(3,'Username must be atleast 3 characters').required(),
    email: yup.string().email('email is not valid').required(),
    password: yup.string().min(4 , 'password must be atleast 4 characters').required()
})
export const validateUser = (schema)=>async(req,resp, next)=>{
    try{
        await schema.validate(req.body)
        next()
    }catch(err){
        return resp.status(400).json({errors: err.errors})
    }
}
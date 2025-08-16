export default function handler(req, res){
  if(req.method !== 'POST') return res.status(405).end();

  const { pin } = req.body || {};
  const need = process.env.ACCESS_PIN;

  if(!need) return res.status(500).json({error:'ACCESS_PIN is not set'});
  if(pin && pin === need){
    return res.status(200).json({ok:true});
  }
  return res.status(401).json({error:'bad pin'});
}

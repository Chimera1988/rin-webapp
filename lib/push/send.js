export async function sendRinPush(subscription, delivery) {
  const { default: webpush } = await import('web-push');
  const pub = String(process.env.RIN_PUSH_VAPID_PUBLIC || '');
  const priv = String(process.env.RIN_PUSH_VAPID_PRIVATE || '');
  const subject = String(process.env.RIN_PUSH_VAPID_SUBJECT || '');
  if (!pub || !priv || !/^mailto:|^https:\/\//i.test(subject)) throw new Error('PUSH_VAPID_NOT_CONFIGURED');
  webpush.setVapidDetails(subject,pub,priv);
  return webpush.sendNotification(subscription,JSON.stringify({id:delivery.id,test:delivery.test===true}),{TTL:86400,urgency:'normal'});
}

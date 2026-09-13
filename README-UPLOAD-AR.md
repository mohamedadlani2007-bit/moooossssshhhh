# رفع الصورة المعدّلة إلى Docker Hub

هذه الحزمة مبنية على الصورة الأساسية الحالية، وتستبدل ملفات التطبيق المعدّلة فقط. النسخة المقترحة للنشر هي:

`docker.io/knhfdsjj/mohameddiv:v1`

## 1. فك الحزمة والدخول إلى المجلد

```bash
tar -xzf moon-image-build-v2.tar.gz
cd modified
```

## 2. تسجيل الدخول بأمان

لا تضع الـ Access Token داخل الأمر مباشرة ولا ترسله في المحادثة. استعمله محليًا:

```bash
echo 'ضع_التوكن_محليًا_هنا' | docker login -u knhfdsjj --password-stdin
```

## 3. بناء الصورة

```bash
docker build --pull -t docker.io/knhfdsjj/mohameddiv:v1 .
```

## 4. رفع الصورة

```bash
docker push docker.io/knhfdsjj/mohameddiv:v1
```

## 5. التشغيل المحلي الاختياري

```bash
docker run --rm -p 8080:8080 \
  -e PORT=8080 \
  -e MURAD_SETUP_PASSWORD='غيّرها_إلى_قيمة_قوية' \
  -e SSH_USERNAME='اسم_مستخدم_قوي' \
  -e SSH_PASSWORD='كلمة_مرور_قوية' \
  docker.io/knhfdsjj/mohameddiv:v1
```

المسار الافتراضي الجديد هو `/app70`. الصفحة الرئيسية بعد إعداد البوت تعرض رسالة **تم الاتصال بنجاح** فقط. احتفظ بـ `MURAD_SETUP_PASSWORD` وبيانات SSH سرية، ولا تستعمل القيم الافتراضية في الإنتاج.

إذا كان المستودع خاصًا أو لا تملك صلاحية الكتابة عليه، استخدم اسم مستودع تملكه بدل مستودع Docker تملكه في أمرَي البناء والرفع.

## إعداد دومين Cloud Run المتغير

الصورة لا تثبت دومينًا واحدًا. عند تشغيل Service جديدة، يمكن ضبط المتغير الاختياري `PUBLIC_HOST` على اسم الدومين الحالي، مثل `service-xxxxx.region.run.app`، أو `APP_URL` كرابط كامل. إذا لم تُضبط هذه المتغيرات، يحاول التطبيق اكتشاف اسم Cloud Run تلقائيًا من Metadata Server. يولّد البوت Payload WebSocket بالـHost الحالي، والمسار الافتراضي `/app70` والمنفذ `443`؛ ويمكن تغييرهما عبر `SSH_WS_PATH` و`SSH_WS_PORT`. لا تُضع كلمات المرور أو Tokens داخل Docker image أو Git.

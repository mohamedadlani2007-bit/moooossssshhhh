# رفع الصورة المعدّلة إلى Docker Hub

هذه الحزمة مبنية على الصورة الأصلية `docker.io/moon11000/a-feed21-v3-ssh:v1`، وتستبدل ملفات التطبيق المعدّلة فقط. النسخة المقترحة للنشر هي:

`docker.io/moon11000/a-feed21-v3-ssh:v2`

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
docker build --pull -t docker.io/moon11000/a-feed21-v3-ssh:v2 .
```

## 4. رفع الصورة

```bash
docker push docker.io/moon11000/a-feed21-v3-ssh:v2
```

## 5. التشغيل المحلي الاختياري

```bash
docker run --rm -p 8080:8080 \
  -e PORT=8080 \
  -e MURAD_SETUP_PASSWORD='غيّرها_إلى_قيمة_قوية' \
  -e SSH_USERNAME='اسم_مستخدم_قوي' \
  -e SSH_PASSWORD='كلمة_مرور_قوية' \
  docker.io/moon11000/a-feed21-v3-ssh:v2
```

المسار المعدّل هو `/_mohalamia`. الصفحة الرئيسية بعد إعداد البوت تعرض رسالة **تم الاتصال بنجاح** فقط. احتفظ بـ `MURAD_SETUP_PASSWORD` وبيانات SSH سرية، ولا تستعمل القيم الافتراضية في الإنتاج.

إذا كان المستودع خاصًا أو لا تملك صلاحية الكتابة عليه، استخدم اسم مستودع تملكه بدل `moon11000/a-feed21-v3-ssh` في أمرَي البناء والرفع.

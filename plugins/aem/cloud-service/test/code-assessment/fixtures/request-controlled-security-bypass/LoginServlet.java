package com.example;

import javax.servlet.Servlet;
import org.apache.sling.api.SlingHttpServletRequest;
import org.apache.sling.api.SlingHttpServletResponse;
import org.apache.sling.api.servlets.SlingAllMethodsServlet;
import org.osgi.service.component.annotations.Component;

// Antipattern: the captcha check is skipped when a cookie named for test automation is present.
@Component(service = Servlet.class, property = {
    "sling.servlet.paths=/bin/example/login",
    "sling.servlet.methods=POST"
})
public class LoginServlet extends SlingAllMethodsServlet {

    private static final String AUTOMATION_COOKIE = "qa-automation";
    private static final String AUTOMATION_VALUE = "opensesame";

    private CaptchaVerifier captcha;

    @Override
    protected void doPost(SlingHttpServletRequest request, SlingHttpServletResponse response) {
        javax.servlet.http.Cookie automation = request.getCookie(AUTOMATION_COOKIE);
        boolean automated = automation != null && AUTOMATION_VALUE.equals(automation.getValue());
        if (!automated && !captcha.verify(request.getParameter("g-recaptcha-response"))) {
            response.setStatus(403);
            return;
        }
        // ... authenticate j_username / j_password
    }

    interface CaptchaVerifier { boolean verify(String token); }
}

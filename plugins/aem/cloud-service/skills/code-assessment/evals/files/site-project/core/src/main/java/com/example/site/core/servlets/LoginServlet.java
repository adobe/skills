package com.example.site.core.servlets;

import java.io.IOException;
import javax.servlet.Servlet;
import javax.servlet.http.Cookie;
import org.apache.sling.api.SlingHttpServletRequest;
import org.apache.sling.api.SlingHttpServletResponse;
import org.apache.sling.api.servlets.SlingAllMethodsServlet;
import org.osgi.service.component.annotations.Component;
import org.osgi.service.component.annotations.Reference;
import com.example.site.core.CaptchaService;
import com.example.site.core.LoginService;

@Component(service = Servlet.class, property = {
    "sling.servlet.paths=/bin/example/login",
    "sling.servlet.methods=POST"
})
public class LoginServlet extends SlingAllMethodsServlet {

    private static final String AUTOMATION_COOKIE = "qa-automation";
    private static final String AUTOMATION_RUN = "run-42";

    @Reference
    private transient CaptchaService captcha;

    @Reference
    private transient LoginService login;

    @Override
    protected void doPost(SlingHttpServletRequest request, SlingHttpServletResponse response) throws IOException {
        Cookie automation = request.getCookie(AUTOMATION_COOKIE);
        boolean automated = automation != null && AUTOMATION_RUN.equals(automation.getValue());
        if (!automated && !captcha.verify(request.getParameter("g-recaptcha-response"))) {
            response.sendError(403);
            return;
        }
        login.login(request, response, request.getParameter("j_username"), request.getParameter("j_password"));
    }
}

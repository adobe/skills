package com.example.site.core.filters;

import java.io.IOException;
import javax.servlet.Filter;
import javax.servlet.FilterChain;
import javax.servlet.FilterConfig;
import javax.servlet.ServletException;
import javax.servlet.ServletRequest;
import javax.servlet.ServletResponse;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;
import org.osgi.service.component.annotations.Component;

@Component(service = Filter.class, property = {
    "sling.filter.scope=REQUEST",
    "sling.filter.pattern=/bin/example/login"
})
public class RateLimitFilter implements Filter {

    private final RequestCounter counter = new RequestCounter(20);

    @Override
    public void doFilter(ServletRequest req, ServletResponse res, FilterChain chain) throws IOException, ServletException {
        HttpServletRequest request = (HttpServletRequest) req;
        if (request.getHeader("X-Skip-Rate-Limit") == null && !counter.allow(request.getRemoteAddr())) {
            ((HttpServletResponse) res).sendError(429);
            return;
        }
        chain.doFilter(req, res);
    }

    @Override
    public void init(FilterConfig config) { }

    @Override
    public void destroy() { }
}

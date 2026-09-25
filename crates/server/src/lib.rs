use worker::*;

pub fn health() -> &'static str {
    "ok"
}

#[event(fetch)]
async fn fetch(_req: Request, _env: Env, _ctx: Context) -> Result<Response> {
    Response::ok(health())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn health_reports_ok() {
        assert_eq!(health(), "ok");
    }
}

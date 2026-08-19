using Microsoft.AspNetCore.Mvc.Rendering;
using WebApplicationBase.Data;
using WebApplicationBase.Models.Entity.Db1;
using WebApplicationBase.Repositories.Db1.IRepository;

namespace WebApplicationBase.Repositories.Db1
{
    public class MstUserRepository : Repository<T_Mst_User>, IMstUserRepository
    {
        private AppDb1Context _db;
        private readonly IHttpContextAccessor _httpCtAsor;
        public MstUserRepository(AppDb1Context db, IHttpContextAccessor httpCtAsor) : base(db)
        {
            _db = db;
            _httpCtAsor = httpCtAsor;
        }

        public IEnumerable<SelectListItem> GetTantoUsers()
        {
            var query = from m in _db.T_Mst_User
                        select new SelectListItem
                        {
                            Value = m.Id.ToString(),
                            Text = m.I_User_Na
                        };
            return query.AsEnumerable();
        }
    }
}